import type { Env } from "./env";
import { handleInteraction } from "./discord-interactions";
import { getLastSync } from "./repository";
import { handleSync } from "./sync";

export async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") {
    return Response.json({ ok: true, now: new Date().toISOString(), lastSync: await getLastSync(env.DB) });
  }
  if (request.method === "POST" && pathname === "/api/v1/assignments/sync") return handleSync(request, env);
  if (request.method === "POST" && pathname === "/discord/interactions") return handleInteraction(request, env);
  return Response.json({ error: "not_found" }, { status: 404 });
}
