import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Env } from "./env.js";
import { route } from "./router.js";

export const MAX_BODY_BYTES = 256 * 1024;

async function bodyBytes(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new Error("payload_too_large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

export function createHttpServer(env: Env): Server {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const declaredLength = Number(incoming.headers["content-length"] ?? 0);
      if (declaredLength > MAX_BODY_BYTES) {
        outgoing.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
        outgoing.end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      const method = incoming.method ?? "GET";
      const bytes = await bodyBytes(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(new URL(incoming.url ?? "/", "http://localhost"), {
        method, headers,
        ...(method !== "GET" && method !== "HEAD" ? { body: new Uint8Array(bytes) } : {}),
      });
      const response = await route(request, env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "payload_too_large";
      if (!tooLarge) console.error("HTTP request failed");
      if (!outgoing.headersSent && !outgoing.destroyed) {
        outgoing.writeHead(tooLarge ? 413 : 500, { "Content-Type": "application/json", Connection: "close" });
        outgoing.end(JSON.stringify({ error: tooLarge ? "payload_too_large" : "internal_server_error" }));
      }
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
