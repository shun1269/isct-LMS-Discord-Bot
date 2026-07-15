import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { handleInteraction } from "../src/discord-interactions";
import { syncAssignments } from "../src/repository";
import { assignment, resetDatabase } from "./helpers";

const workerEnv = () => ({ ...env, DISCORD_PUBLIC_KEY: "public" } as Parameters<typeof handleInteraction>[1]);
function request(body: unknown) { return new Request("https://x/discord/interactions", { method: "POST", headers: { "x-signature-ed25519": "sig", "x-signature-timestamp": "time" }, body: JSON.stringify(body) }); }
const valid = async () => true;

describe("Discord interactions", () => {
  beforeEach(resetDatabase);
  it("returns PONG only after signature validation", async () => {
    expect(await (await handleInteraction(request({ type: 1 }), workerEnv(), valid)).json()).toEqual({ type: 1 });
    expect((await handleInteraction(request({ type: 1 }), workerEnv(), async () => false)).status).toBe(401);
  });
  it("returns ephemeral command responses", async () => {
    const item = assignment(1, Math.floor(Date.now() / 1000) + 3600);
    await syncAssignments(env.DB, { source: item.source, complete: true, assignments: [item] });
    for (const name of ["assignments", "sync-status", "unknown"]) {
      const body = await (await handleInteraction(request({ type: 2, data: { name } }), workerEnv(), valid)).json() as { type: number; data: { flags: number; embeds?: unknown[] } };
      expect(body.type).toBe(4); expect(body.data.flags).toBe(64);
      if (name === "assignments") expect(body.data.embeds).toHaveLength(1);
    }
  });
});
