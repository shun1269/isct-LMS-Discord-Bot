import { verifyKey } from "discord-interactions";
import type { Env } from "./env";
import { formatAssignmentList, formatSyncStatus } from "./format";
import { getLastSync, listUpcomingAssignments } from "./repository";

interface InteractionOption { name?: unknown; value?: unknown }
interface InteractionPayload { type?: unknown; data?: { name?: unknown; options?: InteractionOption[] } }
export type SignatureVerifier = (body: string, signature: string, timestamp: string, publicKey: string) => Promise<boolean>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function ephemeral(content: string): Response {
  return json({ type: 4, data: { flags: 64, content, allowed_mentions: { parse: [] } } });
}

function getDays(options: InteractionOption[] | undefined): number {
  const raw = options?.find((option) => option.name === "days")?.value;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : 30;
}

export async function handleInteraction(request: Request, env: Env, verifier: SignatureVerifier = verifyKey): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return json({ error: "unauthorized" }, 401);

  const body = await request.text();
  if (!(await verifier(body, signature, timestamp, env.DISCORD_PUBLIC_KEY))) {
    return json({ error: "unauthorized" }, 401);
  }

  let interaction: InteractionPayload;
  try { interaction = JSON.parse(body) as InteractionPayload; }
  catch { return json({ error: "invalid_payload" }, 400); }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type !== 2 || typeof interaction.data?.name !== "string") {
    return json({ error: "unsupported_interaction" }, 400);
  }

  if (interaction.data.name === "assignments") {
    const days = getDays(interaction.data.options);
    const nowUnix = Math.floor(Date.now() / 1000);
    const assignments = await listUpcomingAssignments(env.DB, nowUnix, nowUnix + days * 86_400, 50);
    return ephemeral(formatAssignmentList(assignments, days));
  }
  if (interaction.data.name === "sync-status") {
    return ephemeral(formatSyncStatus(await getLastSync(env.DB)));
  }
  return ephemeral("未知のコマンドです。コマンドを再登録してください。");
}
