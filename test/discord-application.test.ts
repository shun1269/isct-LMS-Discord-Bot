import { describe, expect, it, vi } from "vitest";
import { verifyDiscordApplication } from "../src/discord-application.js";
import { env } from "./helpers.js";

describe("Gateway migration checks", () => {
  it("requires removal of the existing HTTP endpoint before Gateway startup", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: env.DISCORD_APPLICATION_ID, interactions_endpoint_url: "https://old.example/discord/interactions" }));
    await expect(verifyDiscordApplication({ ...env, DISCORD_MODE: "gateway" }, fetcher)).rejects.toThrow(/Clear the Interactions Endpoint/);
  });
  it("allows Gateway only with a matching application and no HTTP endpoint", async () => {
    const fetcher = vi.fn(async () => Response.json({ id: env.DISCORD_APPLICATION_ID, interactions_endpoint_url: null }));
    await expect(verifyDiscordApplication({ ...env, DISCORD_MODE: "gateway" }, fetcher)).resolves.toBeUndefined();
    const wrong = vi.fn(async () => Response.json({ id: "other" }));
    await expect(verifyDiscordApplication(env, wrong)).rejects.toThrow(/does not match/);
  });
});
