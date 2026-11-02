import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
const values = { SYNC_TOKEN: "a".repeat(32), DISCORD_BOT_TOKEN: "test", DISCORD_APPLICATION_ID: "1", DISCORD_GUILD_ID: "2", DISCORD_CHANNEL_ID: "3" };
describe("Ubuntu configuration", () => {
  it("defaults to loopback and Gateway without requiring a public key", () => {
    expect(loadConfig(values)).toMatchObject({ HOST: "127.0.0.1", PORT: 3000, DISCORD_MODE: "gateway" });
  });
  it("rejects unusable secrets, modes, ports and HTTP verification keys", () => {
    expect(() => loadConfig({ ...values, SYNC_TOKEN: "short" })).toThrow(/SYNC_TOKEN/);
    expect(() => loadConfig({ ...values, PORT: "0" })).toThrow(/PORT/);
    expect(() => loadConfig({ ...values, DISCORD_MODE: "wrong" })).toThrow(/DISCORD_MODE/);
    expect(() => loadConfig({ ...values, DISCORD_MODE: "http", DISCORD_PUBLIC_KEY: "invalid" })).toThrow(/DISCORD_PUBLIC_KEY/);
    expect(() => loadConfig({ ...values, DISCORD_OWNER_ID: "<@99>" })).toThrow(/DISCORD_OWNER_ID/);
  });
  it("leaves todo messages disabled unless an owner is configured", () => {
    expect(loadConfig(values).DISCORD_OWNER_ID).toBe("");
    expect(loadConfig({ ...values, DISCORD_OWNER_ID: " 99 " }).DISCORD_OWNER_ID).toBe("99");
  });
});
