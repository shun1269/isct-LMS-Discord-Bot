import type { Env } from "./env";
import { checkReminders } from "./reminders";
import { route } from "./router";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      console.error("Unhandled request error", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "internal_server_error" }, { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkReminders(env));
  },
} satisfies ExportedHandler<Env>;
