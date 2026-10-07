import test from "node:test";
import assert from "node:assert/strict";
import { calculateMvRating, parseCsRep, parseCsStats } from "../scripts/collect-player-stats.mjs";

test("parses core CSStats metrics", () => {
  const metrics = parseCsStats("K/D\n0.79\nHLTV RATING\n0.89\nWIN RATE\n40%\nPLAYED 217\nHS% 46%\nADR 64\nKAST 68%\nS1 2023 124 11,502 12,524");
  assert.equal(metrics.kd, 0.79);
  assert.equal(metrics.hltv, 0.89);
  assert.equal(metrics.premier_current, 11502);
  assert.equal(metrics.matches, 217);
});

test("parses core CSRep metrics with decimal commas", () => {
  const metrics = parseCsRep("Trust Score 100% Stats Overview Last 10 Matches Time to Damage 512 ms Reaction Time 370 ms Crosshair Placement 6,4 ° Preaim 9,9 ° K/D Ratio 1,51 ADR 107,3 Aim Accuracy 21,5% Head Accuracy 12,4% HLTV Rating 2.0 1,48 KAST 72,0%");
  assert.equal(metrics.kd, 1.51);
  assert.equal(metrics.hltv, 1.48);
  assert.equal(metrics.adr, 107.3);
  assert.equal(metrics.matches, 10);
});

test("high FACEIT baseline beats dominant mid Premier player without erasing performance", () => {
  const faceit = calculateMvRating({ faceit_level: 10, faceit_elo: 2800, premier_rating: null }, {}, { kd: 1.01, hltv: 1.1, adr: 75, kast: 70, matches: 20 });
  const premier = calculateMvRating({ faceit_level: null, faceit_elo: null, premier_rating: 15000 }, {}, { kd: 1.8, hltv: 1.6, adr: 100, kast: 80, matches: 20 });
  assert.ok(faceit.mv_rating > premier.mv_rating);
  assert.ok(premier.performance_score > faceit.performance_score);
});
