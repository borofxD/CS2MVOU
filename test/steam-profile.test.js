import test from "node:test";
import assert from "node:assert/strict";
import { extractSteamId64, parseSteamProfileInput, resolveSteamId64 } from "../js/steam-profile.js";

test("accepts raw SteamID64 and profile URLs", () => {
  assert.equal(extractSteamId64("https://steamcommunity.com/profiles/76561199014678776/"), "76561199014678776");
  assert.deepEqual(parseSteamProfileInput("76561199014678776"), { kind: "steam_id", steamId: "76561199014678776" });
});

test("accepts Steam vanity URLs and rejects foreign domains", () => {
  assert.deepEqual(parseSteamProfileInput("https://steamcommunity.com/id/ebakin/"), { kind: "vanity", vanity: "ebakin" });
  assert.throws(() => parseSteamProfileInput("https://example.com/id/ebakin"), /steamcommunity\.com/);
});

test("resolves a vanity URL through the server function", async () => {
  const fetchStub = async () => ({
    ok: true,
    json: async () => ({ steam_id: "76561199014678776" })
  });
  assert.equal(await resolveSteamId64("https://steamcommunity.com/id/ebakin", fetchStub), "76561199014678776");
});
