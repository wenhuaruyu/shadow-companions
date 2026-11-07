import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";

export const webRoot = fileURLToPath(new URL("./", import.meta.url));
export const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

function proxy(request, response, target) {
  const destination = new URL(request.url, target);
  const transport =
    destination.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = transport(
    destination,
    {
      method: request.method,
      headers: { ...request.headers, host: destination.host },
    },
    (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    },
  );
  upstream.setTimeout(15000, () => upstream.destroy());
  upstream.on("error", () => {
    if (response.headersSent) return response.destroy();
    response.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        code: "BACKEND_UNAVAILABLE",
        message: "后端连接失败，请检查API_TARGET",
      }),
    );
  });
  request.on("aborted", () => upstream.destroy());
  response.on("close", () => upstream.destroy());
  request.pipe(upstream);
}

export function createWebServer({
  apiTarget = process.env.API_TARGET || "http://127.0.0.1:3000",
  root = webRoot,
} = {}) {
  const target = new URL(apiTarget);
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("API_TARGET必须使用http或https");
  return createServer(async (request, response) => {
    if (request.url.startsWith("/api/"))
      return proxy(request, response, target);
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url, "http://localhost");
      const pathname = decodeURIComponent(url.pathname);
      let path;
      if (pathname === "/") path = resolve(root, "index.html");
      else if (pathname.startsWith("/src/"))
        path = resolve(root, "." + pathname);
      else path = resolve(root, "public", "." + pathname);
      const allowed =
        path === resolve(root, "index.html") ||
        path.startsWith(resolve(root, "src") + sep) ||
        path.startsWith(resolve(root, "public") + sep);
      if (!allowed || !(await stat(path)).isFile())
        throw new Error("Not found");
      const body = await readFile(path);
      response.writeHead(200, {
        "Content-Type": mimeTypes[extname(path)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.WEB_PORT || 5173);
  createWebServer().listen(port, process.env.WEB_HOST || "127.0.0.1", () => {
    console.log(
      `前端 http://localhost:${port}，API代理 ${process.env.API_TARGET || "http://127.0.0.1:3000"}`,
    );
  });
}
