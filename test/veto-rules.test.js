import test from "node:test";
import assert from "node:assert/strict";
import { getExpectedActor, getExpectedStep, getMapStatus, MAP_POOL, VETO_PLANS } from "../js/veto-rules.js";

test("current Active Duty pool contains seven unique maps including Cache", () => {
  assert.equal(MAP_POOL.length, 7);
  assert.equal(new Set(MAP_POOL.map((map) => map.id)).size, 7);
  assert.ok(MAP_POOL.some((map) => map.id === "cache"));
});

test("BO1 and BO3 plans match the Valve-style order", () => {
  assert.deepEqual(VETO_PLANS[1].map(([type, role]) => `${role}:${type}`), [
    "A:ban", "A:ban", "B:ban", "B:ban", "B:ban", "A:ban", "B:side"
  ]);
  assert.deepEqual(VETO_PLANS[3].map(([type, role]) => `${role}:${type}`), [
    "A:ban", "B:ban", "A:pick", "B:side", "B:pick", "A:side", "B:ban", "A:ban", "B:side"
  ]);
});

test("expected actor and map status follow synchronized state", () => {
  const state = {
    format: 3,
    roles: { teamA: "team2", teamB: "team1" },
    actions: [{ type: "ban", map: "nuke", by: "team2" }],
    series: []
  };
  assert.deepEqual(getExpectedStep(state), { type: "ban", role: "B", mapNo: null });
  assert.equal(getExpectedActor(state), "team1");
  assert.equal(getMapStatus(state, "nuke"), "ban");
  assert.equal(getMapStatus(state, "cache"), "available");
});
