import { once } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { request as httpRequest, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpServer, MAX_BODY_BYTES } from "../src/http-server.js";
import { env, assignment, resetDatabase } from "./helpers.js";

let server: Server | undefined;
let base: string;
beforeEach(async () => {
  await resetDatabase();
  server = createHttpServer({ ...env, SYNC_TOKEN: "a".repeat(32) });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((resolve) => server!.close(() => resolve())); } });

describe("Node HTTP adapter", () => {
  it("serves health, authenticates sync, and preserves Japanese titles", async () => {
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/unknown`)).status).toBe(404);
    expect((await fetch(`${base}/api/v1/assignments/sync`, { method: "POST", body: "{}" })).status).toBe(401);
    const item = assignment();
    const response = await fetch(`${base}/api/v1/assignments/sync`, { method: "POST", headers: { authorization: `Bearer ${"a".repeat(32)}`, "content-type": "application/json" }, body: JSON.stringify({ source: item.source, complete: true, assignments: [item] }) });
    expect(await response.json()).toEqual({ ok: true, received: 1, active: 1 });
    expect(await env.DB.prepare("SELECT title FROM assignments").first("title")).toBe(item.title);
    const health = await (await fetch(`${base}/health`)).text();
    expect(health).not.toContain(item.title);
    expect(health).not.toContain("test-bot-token");
  });

  it("limits both declared and chunked request sizes", async () => {
    const response = await fetch(`${base}/api/v1/assignments/sync`, { method: "POST", body: "x".repeat(MAX_BODY_BYTES + 1) });
    expect(response.status).toBe(413);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/v1/assignments/sync`, { method: "POST", headers: { "Transfer-Encoding": "chunked" } }, (result) => { result.resume(); resolve(result.statusCode!); });
      request.on("error", reject);
      request.write(Buffer.alloc(MAX_BODY_BYTES));
      request.end("x");
    });
    expect(status).toBe(413);
  });

  it("verifies real Discord Ed25519 signatures using the raw body", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    env.DISCORD_PUBLIC_KEY = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
    // The server's env copy receives this key through a fresh instance.
    server!.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = createHttpServer(env);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/discord/interactions`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: 1 });
    const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");
    const headers = { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp };
    expect(await (await fetch(url, { method: "POST", headers, body })).json()).toEqual({ type: 1 });
    expect((await fetch(url, { method: "POST", headers, body: body + " " })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers: { ...headers, "x-signature-ed25519": "bad" }, body })).status).toBe(401);
  });
});
