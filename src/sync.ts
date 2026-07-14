import type { Env } from "./env";
import { syncAssignments } from "./repository";
import { syncPayloadSchema } from "./schemas";

const MAX_BODY_BYTES = 256 * 1024;

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

function authorized(request: Request, expected: string): boolean {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "");
  return Boolean(match?.[1] && expected && constantTimeEqual(match[1], expected));
}

export async function handleSync(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.SYNC_TOKEN)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  let input: unknown;
  try { input = JSON.parse(body); }
  catch { return Response.json({ error: "invalid_payload", details: [] }, { status: 400 }); }
  const parsed = syncPayloadSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: "invalid_payload", details: parsed.error.issues }, { status: 400 });
  }
  const result = await syncAssignments(env.DB, parsed.data);
  console.log("Assignments synchronized", { received: result.received, active: result.active });
  return Response.json({ ok: true, ...result });
}
