import { createServer } from 'node:http';
import { ApiError, RoomService } from './rooms.js';

export function createRoomServer(pool, publicOrigin, service = new RoomService(pool, publicOrigin)) {
  return createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    let requestId;
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/api/health' && request.method === 'GET') {
        response.end(JSON.stringify({ status: 'ok', contractVersion: 2 }));
        return;
      }
      if (request.headers['x-contract-version'] !== '2') {
        throw new ApiError(400, 'CONTRACT_VERSION_MISMATCH', '请使用第二版接口协议');
      }
      let result;
      let status = 200;
      if (['/api/create', '/api/join'].includes(url.pathname) && request.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 12000) throw new ApiError(400, 'INVALID_INPUT', '请求过大');
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new ApiError(400, 'INVALID_INPUT', 'JSON格式错误'); }
        requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
        result = await service.enter(body, url.pathname === '/api/join');
        status = result.replayed ? 200 : 201;
      } else if (url.pathname === '/api/state' && request.method === 'GET') {
        const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
        const snapshot = await service.state(url.searchParams.get('room'), token);
        const changed = url.searchParams.get('knownVersion') !== String(snapshot.version);
        result = { changed, version: snapshot.version, ...(changed ? { snapshot } : {}) };
      } else {
        throw new ApiError(404, 'ENDPOINT_NOT_AVAILABLE', '当前阶段未开放此接口');
      }
      response.statusCode = status;
      response.end(JSON.stringify({ contractVersion: 2, serverTime: new Date().toISOString(), requestId, ...result }));
    } catch (error) {
      const expected = error instanceof ApiError;
      response.statusCode = expected ? error.status : 503;
      const message = expected ? error.message : '服务暂时不可用，请稍后重试';
      response.end(JSON.stringify({ code: expected ? error.code : 'TEMPORARILY_UNAVAILABLE',
        message, error: message, requestId, retryable: !expected }));
    }
  });
}
