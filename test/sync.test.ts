import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { syncAssignments } from "../src/repository";
import { handleSync } from "../src/sync";
import { assignment, resetDatabase } from "./helpers";

const workerEnv = () => ({ ...env, SYNC_TOKEN: "a".repeat(32) } as Parameters<typeof handleSync>[1]);

describe("assignment sync", () => {
  beforeEach(resetDatabase);
  it("deactivates missing rows only for complete sync and upserts changes", async () => {
    const first = assignment(1); const second = assignment(2);
    await syncAssignments(env.DB, { source: first.source, complete: true, assignments: [first, second] });
    await syncAssignments(env.DB, { source: first.source, complete: false, assignments: [{ ...first, title: "変更後" }] });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM assignments WHERE is_active=1").first("count")).toBe(2);
    await syncAssignments(env.DB, { source: first.source, complete: true, assignments: [{ ...first, title: "変更後" }] });
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM assignments WHERE is_active=1").first("count")).toBe(1);
    expect(await env.DB.prepare("SELECT title FROM assignments WHERE event_id=1").first("title")).toBe("変更後");
    expect(await env.DB.prepare("SELECT COUNT(*) count FROM assignments").first("count")).toBe(2);
  });

  it("rejects invalid authorization and mismatched sources", async () => {
    const badAuth = new Request("https://x/api/v1/assignments/sync", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect((await handleSync(badAuth, workerEnv())).status).toBe(401);
    const item = assignment();
    const request = new Request("https://x/api/v1/assignments/sync", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${"a".repeat(32)}` }, body: JSON.stringify({ source: "science-tokyo-lms-2025", complete: true, assignments: [item] }) });
    expect((await handleSync(request, workerEnv())).status).toBe(400);
  });
});
