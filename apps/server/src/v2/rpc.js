import { gameSnapshot } from './snapshot.js';
import { ApiError, validateEntry, entryIdentity, tokenDigest, databaseError } from './rooms.js';

export class RpcRoomService {
  constructor(endpoint, serviceToken, publicOrigin, fetcher = fetch) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new Error('RPC需要HTTPS地址');
    if (!serviceToken || /\s/.test(serviceToken)) throw new Error('缺少有效的RPC服务端凭证');
    this.endpoint = url.href.replace(/\/$/, '');
    this.serviceToken = serviceToken;
    this.publicOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
    this.fetcher = fetcher;
  }

  async call(name, parameters) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await this.fetcher(`${this.endpoint}/${name}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.serviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
        signal: AbortSignal.timeout(8000),
        redirect: 'error'
      });
      const body = await response.json();
      if (response.ok) {
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('RPC响应格式错误');
        return body;
      }
      const expected = databaseError(body);
      if (expected) throw expected;
      if (['40001', '40P01'].includes(body?.code) && attempt < 2) continue;
      const upstreamCode = typeof body?.code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(body.code)
        ? body.code : 'UNKNOWN';
      const message = typeof body?.message === 'string' ? body.message : '';
      const category = ['RPC_FORBIDDEN', 'permission denied', 'does not exist', 'JWT', 'expired', 'credential']
        .find(marker => message.toLowerCase().includes(marker.toLowerCase())) || 'unclassified';
      console.error(JSON.stringify({ event: 'rpc_failure', status: response.status, code: upstreamCode, category }));
      throw new ApiError(503, 'RPC_UPSTREAM_FAILURE', `数据库网关调用失败（HTTP ${response.status}，${upstreamCode}，${category}）`);
    }
  }

  async enter(body, joining = false) {
    validateEntry(body, joining);
    if (!this.publicOrigin) throw new ApiError(503, 'PUBLIC_ORIGIN_REQUIRED', '邀请地址尚未配置');
    const { tokenHash, scope, payload } = entryIdentity(body, joining);
    const result = await this.call('anxian_room_enter', {
      p_request_id: body.requestId, p_token_hash: tokenHash, p_scope: scope,
      p_payload: payload, p_content_version: joining ? null : body.contentVersion,
      p_room: joining ? body.room : null, p_joining: joining
    });
    return { ...result, token: body.recoverySecret, inviteUrl: `${this.publicOrigin}/?invite=${result.id}` };
  }

  async loadGame(room, token, requestId) {
    return this.call('anxian_game_load', { p_room: room, p_token_hash: tokenDigest(token), p_request_id: requestId ?? null });
  }

  async commitGame(document, token, rewards, requestId, payload) {
    return this.call('anxian_game_reward_commit', { p_room: document.id, p_token_hash: tokenDigest(token),
      p_version: document.version, p_state: document.state, p_rewards: rewards,
      p_request_id: requestId ?? null, p_payload: payload ?? null });
  }

  async state(room, token) {
    if (typeof room !== 'string' || typeof token !== 'string') throw new ApiError(401, 'INVALID_CREDENTIAL', '本人凭证无效');
    return gameSnapshot(await this.loadGame(room, token));
  }
}
