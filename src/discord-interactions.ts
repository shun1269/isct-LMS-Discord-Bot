import { verifyKey } from "discord-interactions";
import type { Env } from "./env.js";
import { commandReply, componentReply } from "./commands.js";

interface InteractionOption { name?: unknown; value?: unknown }
interface InteractionPayload { type?: unknown; guild_id?: unknown; data?: { name?: unknown; options?: InteractionOption[]; custom_id?: unknown; values?: unknown } }
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
  let verified = false;
  try { verified = await verifier(body, signature, timestamp, env.DISCORD_PUBLIC_KEY); }
  catch { /* Malformed signatures are authentication failures. */ }
  if (!verified) {
    return json({ error: "unauthorized" }, 401);
  }

  let interaction: InteractionPayload;
  try { interaction = JSON.parse(body) as InteractionPayload; }
  catch { return json({ error: "invalid_payload" }, 400); }

  if (interaction.type === 1) return json({ type: 1 });
  if (interaction.type === 3) {
    if (interaction.guild_id !== env.DISCORD_GUILD_ID) return ephemeral("このサーバーでは利用できません。");
    const values = Array.isArray(interaction.data?.values) ? interaction.data.values.filter((value): value is string => typeof value === "string") : [];
    const reply = typeof interaction.data?.custom_id === "string" ? await componentReply(env, interaction.data.custom_id, values) : null;
    if (!reply) return ephemeral("この操作は利用できません。`/課題` を再実行してください。");
    // Type 7 updates the message that carried the component.
    return json({ type: 7, data: { ...reply, allowed_mentions: { parse: [] } } });
  }
  if (interaction.type !== 2 || typeof interaction.data?.name !== "string") {
    return json({ error: "unsupported_interaction" }, 400);
  }

  return json({ type: 4, data: { flags: 64, ...await commandReply(env, interaction.data.name, getDays(interaction.data.options)), allowed_mentions: { parse: [] } } });
}
