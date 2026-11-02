import type { Env } from "./env.js";
import { handleInteraction } from "./discord-interactions.js";
import { getLastSync } from "./repository.js";
import { handleSync } from "./sync.js";

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") {
    return Response.json({ ok: true, now: new Date().toISOString(), lastSync: await getLastSync(env.DB) });
  }
  if (request.method === "POST" && pathname === "/api/v1/assignments/sync") return handleSync(request, env);
  if (env.DISCORD_MODE === "http" && request.method === "POST" && pathname === "/discord/interactions") return handleInteraction(request, env);
  return Response.json({ error: "not_found" }, { status: 404 });
}
