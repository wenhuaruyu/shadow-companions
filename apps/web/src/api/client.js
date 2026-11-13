import {
  newRecoverySecret,
  newRequestId,
  readStored,
  saveSession,
} from "../state/storage.js";

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createApiClient({
  storage,
  getSession,
  getSnapshot,
  fetcher = globalThis.fetch,
  rulesVersion,
}) {
  let queue = Promise.resolve();
  const inputSequences = new Map();

  async function request(path, body) {
    const session = getSession();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetcher("/api/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Contract-Version": "2",
          ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch {
      throw new ApiError("连接失败，请重试原操作", "NETWORK_ERROR", 0);
    } finally {
      clearTimeout(timeout);
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new ApiError(
        "接口未返回JSON，请检查开发代理和后端地址",
        "INVALID_RESPONSE",
        response.status,
      );
    }
    if (!response.ok) {
      throw new ApiError(
        result.message || result.error || "请求失败",
        result.code,
        response.status,
      );
    }
    return result;
  }

  async function enter(room) {
    const key = room
      ? `anxian.entry.v2.join.${room}`
      : "anxian.entry.v2.create";
    let body = readStored(storage, key);
    if (!body) {
      body = {
        requestId: newRequestId(),
        recoverySecret: newRecoverySecret(),
        ...(room ? { room } : { contentVersion: "mvp-two-sites-1", ...(rulesVersion ? { rulesVersion } : {}) }),
      };
      storage.setItem(key, JSON.stringify(body));
    }
    const result = await request(room ? "join" : "create", body);
    const session = { id: result.id, token: result.token, seat: result.seat };
    saveSession(storage, session);
    storage.removeItem(key);
    return { ...result, session };
  }

  function action(kind, data = {}) {
    const operation = queue.then(async () => {
      const session = getSession();
      const snapshot = getSnapshot();
      if (!session || !snapshot)
        throw new ApiError("请先恢复当前对局", "NO_SESSION", 401);
      const pendingKey = `anxian.action.v2.${session.id}`;
      let body = readStored(storage, pendingKey);
      if (
        body &&
        (body.kind !== kind ||
          JSON.stringify(body.data) !== JSON.stringify(data))
      ) {
        throw new ApiError(
          "上次操作尚未确认，请先重试上次操作",
          "PENDING_ACTION",
          409,
        );
      }
      if (!body) {
        body = {
          room: session.id,
          requestId: newRequestId(),
          kind,
          data,
          chapter: snapshot.chapter,
          expectedVersion: snapshot.version,
          expectedPhase: snapshot.phase,
        };
        if (
          snapshot.attempt &&
          ["answers", "hit", "finish", "abandon", "judge", "alley_move", "coop_role", "coop_ready", "coop_move", "coop_light", "coop_escape"].includes(kind)
        ) {
          body.attemptId = snapshot.attempt.id;
        }
        if (["answers", "hit", "draft", "judge", "alley_move", "coop_role", "coop_ready", "coop_move", "coop_light", "coop_escape"].includes(kind)) {
          const scope =
            kind === "draft"
              ? `draft.${snapshot.chapter}`
              : snapshot.attempt.id;
          const saved = Number(storage.getItem(`anxian.seq.${scope}`) || -1);
          body.inputSeq =
            Math.max(
              saved,
              inputSequences.get(scope) ?? -1,
              snapshot.attempt?.inputSeq ?? -1,
            ) + 1;
          inputSequences.set(scope, body.inputSeq);
          storage.setItem(`anxian.seq.${scope}`, String(body.inputSeq));
        }
        if (kind === "resume")
          body.pauseId = snapshot.pause?.id || snapshot.pause?.pauseId;
        storage.setItem(pendingKey, JSON.stringify(body));
      }
      try {
        const result = await request("action", body);
        storage.removeItem(pendingKey);
        return result;
      } catch (error) {
        // Network errors and unavailable responses can hide a committed action.
        if (error.status && ![429, 503, 504].includes(error.status))
          storage.removeItem(pendingKey);
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }

  async function state(force = false) {
    const session = getSession();
    const params = new URLSearchParams({ room: session.id });
    const snapshot = getSnapshot();
    if (!force && snapshot) params.set("knownVersion", snapshot.version);
    return request(`state?${params}`);
  }

  return {
    create: () => enter(),
    join: (room) => enter(room),
    action,
    state,
    instruction: () =>
      request(`instruction?${new URLSearchParams({ room: getSession().id })}`),
    pending: () => readStored(storage, `anxian.action.v2.${getSession()?.id}`),
  };
}
