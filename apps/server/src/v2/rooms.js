import { createHash, randomUUID } from 'node:crypto';
import { gameSnapshot } from './snapshot.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const businessErrors = {
  INVALID_INPUT: [400, '输入格式错误'],
  CONTENT_VERSION_UNSUPPORTED: [400, '内容版本不受支持'],
  REQUEST_ID_CONFLICT: [409, '请求编号已用于不同参数'],
  ACTION_ALREADY_DONE: [409, '已占有座位，请使用原请求编号恢复'],
  ROOM_FULL: [409, '本次行动已有两名玩家'],
  ROOM_NOT_FOUND: [404, '对局不存在'],
  INVITE_EXPIRED: [410, '邀请已过期'],
  INVALID_CREDENTIAL: [401, '本人凭证无效']
};

export function databaseError(error) {
  const known = businessErrors[error?.message];
  if (['P0001', 'DATABASE_P0001'].includes(error?.code) && known) {
    return new ApiError(known[0], error.message, known[1]);
  }
  return null;
}

const hash = value => createHash('sha256').update(value).digest('hex');
const reject = (status, code, message) => { throw new ApiError(status, code, message); };
export const CONTENT_VERSION = 'mvp-two-sites-1';

export function validateEntry(body, joining) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    reject(400, 'INVALID_INPUT', '请求必须为对象');
  }
  if (typeof body.requestId !== 'string' || !/^[\w-]{8,128}$/.test(body.requestId)) {
    reject(400, 'INVALID_INPUT', '请求编号格式错误');
  }
  // 32 random bytes encoded as canonical base64url.
  if (typeof body.recoverySecret !== 'string' || !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(body.recoverySecret)) {
    reject(400, 'INVALID_INPUT', '恢复凭证须为32字节随机值的base64url编码');
  }
  if (joining && (typeof body.room !== 'string' || !/^[0-9a-f-]{36}$/.test(body.room))) {
    reject(400, 'INVALID_INPUT', '房间编号格式错误');
  }
  if (!joining && body.contentVersion !== CONTENT_VERSION) {
    reject(400, 'CONTENT_VERSION_UNSUPPORTED', '内容版本不受支持');
  }
}

export function entryIdentity(body, joining) {
  const tokenHash = hash(body.recoverySecret);
  const scope = hash(JSON.stringify([joining ? 'join' : 'create', joining ? body.room : '', tokenHash]));
  const payload = hash(JSON.stringify(joining ? [body.room] : [body.contentVersion]));
  return { tokenHash, scope, payload };
}

export function tokenDigest(token) {
  return hash(token);
}

export class RoomService {
  constructor(pool, publicOrigin, clock = Date.now) {
    this.pool = pool;
    this.publicOrigin = new URL(publicOrigin).origin;
    this.clock = clock;
  }

  async enter(body, joining = false) {
    validateEntry(body, joining);
    const { tokenHash, scope, payload } = entryIdentity(body, joining);
    // Creation retries race on the receipt's unique key. A losing transaction
    // rolls its newly created room back, then reads the committed receipt.
    for (let attempt = 0; attempt < 3; attempt++) {
      const connection = await this.pool.connect();
      try {
        await connection.query('BEGIN');
        const { rows: receipts } = await connection.query(
          'SELECT * FROM anxian.game_requests WHERE scope_hash=$1 AND request_id=$2 FOR UPDATE', [scope, body.requestId]);
        let roomId;
        let seat;
        let replayed = false;
        if (receipts.length) {
          const receipt = receipts[0];
          if (receipt.payload_hash !== payload) reject(409, 'REQUEST_ID_CONFLICT', '请求编号已用于不同参数');
          roomId = receipt.room_id;
          seat = receipt.seat;
          replayed = true;
          await connection.query('SELECT id FROM anxian.game_rooms WHERE id=$1 FOR UPDATE', [roomId]);
        } else {
          roomId = joining ? body.room : randomUUID();
          if (!joining) {
            await connection.query('INSERT INTO anxian.game_rooms (id,content_version,created_at) VALUES ($1,$2,$3)',
              [roomId, body.contentVersion, this.clock()]);
          }
          const { rows: roomRows } = await connection.query('SELECT * FROM anxian.game_rooms WHERE id=$1 FOR UPDATE', [roomId]);
          if (!roomRows.length) reject(404, 'ROOM_NOT_FOUND', '对局不存在');
          const { rows: committedReceipts } = await connection.query(
            'SELECT room_id FROM anxian.game_requests WHERE scope_hash=$1 AND request_id=$2', [scope, body.requestId]);
          if (committedReceipts.length) {
            await connection.query('ROLLBACK');
            continue;
          }
          const { rows: players } = await connection.query('SELECT seat,token_hash FROM anxian.game_players WHERE room_id=$1 FOR UPDATE', [roomId]);
          if (players.some(player => player.token_hash === tokenHash)) {
            reject(409, 'ACTION_ALREADY_DONE', '已占有座位，请使用原请求编号恢复');
          }
          if (players.length >= 2) reject(409, 'ROOM_FULL', '本次行动已有两名玩家');
          if (joining && this.clock() - Number(roomRows[0].created_at) >= 900000) {
            reject(410, 'INVITE_EXPIRED', '邀请已过期');
          }
          seat = players.length;
          await connection.query('INSERT INTO anxian.game_players (room_id,seat,token_hash) VALUES ($1,$2,$3)', [roomId, seat, tokenHash]);
          await connection.query('UPDATE anxian.game_rooms SET version=version+1 WHERE id=$1', [roomId]);
          await connection.query('INSERT INTO anxian.game_requests (scope_hash,request_id,payload_hash,room_id,seat) VALUES ($1,$2,$3,$4,$5)',
            [scope, body.requestId, payload, roomId, seat]);
        }
        const snapshot = await this.readSnapshot(connection, roomId, tokenHash);
        await connection.query('COMMIT');
        return { id: roomId, seat, token: body.recoverySecret, replayed,
          inviteUrl: `${this.publicOrigin}/?invite=${roomId}`, snapshot };
      } catch (error) {
        await connection.query('ROLLBACK');
        if (['23505', '40P01', '40001'].includes(error.code) && attempt < 2) continue;
        throw error;
      } finally {
        connection.release();
      }
    }
  }

  async readSnapshot(connection, roomId, tokenHash) {
    const { rows: players } = await connection.query('SELECT seat,token_hash FROM anxian.game_players WHERE room_id=$1 ORDER BY seat', [roomId]);
    const me = players.find(player => player.token_hash === tokenHash);
    if (!me) reject(401, 'INVALID_CREDENTIAL', '本人凭证无效');
    const { rows: rooms } = await connection.query('SELECT * FROM anxian.game_rooms WHERE id=$1', [roomId]);
    const room = rooms[0];
    return gameSnapshot({ id: roomId, version: Number(room.version), contentVersion: room.content_version,
      state: room.game_state, seat: me.seat, playerCount: players.length });
  }

  async gameQuery(sql, parameters) {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: 'service_role' })]);
      const result = await connection.query(sql, parameters);
      await connection.query('COMMIT');
      return result.rows[0].result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw databaseError(error) || error;
    } finally { connection.release(); }
  }

  async loadGame(room, token, requestId) {
    return this.gameQuery('SELECT public.anxian_game_load($1,$2,$3) AS result', [room, hash(token), requestId ?? null]);
  }

  async commitGame(document, token, requestId, payload) {
    return this.gameQuery('SELECT public.anxian_game_commit($1,$2,$3,$4,$5,$6) AS result',
      [document.id, hash(token), document.version, JSON.stringify(document.state), requestId ?? null, payload ?? null]);
  }

  async state(roomId, token) {
    if (typeof roomId !== 'string' || typeof token !== 'string') reject(401, 'INVALID_CREDENTIAL', '本人凭证无效');
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await this.readSnapshot(connection, roomId, hash(token));
      await connection.query('COMMIT');
      return snapshot;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
}
