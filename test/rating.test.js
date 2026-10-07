import test from "node:test";
import assert from "node:assert/strict";
import { calculateMvRating, parseCsRep, parseCsStats, scrapePage } from "../scripts/collect-player-stats.mjs";

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

test("calculates a provisional rating from declared rank when stat sites are unavailable", () => {
  const rating = calculateMvRating({ faceit_level: 10, faceit_elo: 2121, premier_rating: null }, {}, {});
  assert.ok(rating.mv_rating > 50);
  assert.equal(rating.explanation.sources, 0);
  assert.equal(rating.confidence, 10);
});

test("treats zero Premier rating as missing", () => {
  const zero = calculateMvRating({ faceit_level: 10, faceit_elo: 2121, premier_rating: 0 }, { premier_current: 20635 }, {});
  const missing = calculateMvRating({ faceit_level: 10, faceit_elo: 2121, premier_rating: null }, { premier_current: 20635 }, {});
  assert.equal(zero.mv_rating, missing.mv_rating);
  assert.equal(zero.explanation.premier_rating, 20635);
});

test("blends long-term CSStats with recent CSRep form at 60 to 40", () => {
  const rating = calculateMvRating(
    { faceit_level: 10, faceit_elo: 2815, premier_rating: 25120 },
    { kd: 1.35, hltv: 1.31, adr: 95, matches: 30 },
    { kd: 1.6, hltv: 1.5, adr: 110, kast: 77.9, matches: 20 }
  );
  assert.equal(rating.explanation.kd, 1.4500000000000002);
  assert.equal(rating.explanation.hltv, 1.3860000000000001);
  assert.equal(rating.explanation.adr, 101);
  assert.equal(rating.mv_rating, 86.03);
  assert.equal(rating.model_version, "mv-1.1");
});

test("reloads an incomplete stats page and retries collection", async () => {
  let bodyReads = 0;
  let reloads = 0;
  const page = {
    goto: async () => {},
    reload: async () => { reloads += 1; },
    waitForFunction: async () => {},
    waitForTimeout: async () => {},
    locator: () => ({
      innerText: async () => {
        bodyReads += 1;
        if (bodyReads === 1) return "HLTV RATING 1.39";
        return "K/D 1.42 HLTV RATING 1.39 WIN RATE 53% PLAYED 559 HS% 48% ADR 95 KAST 74% KILLS 11208 DEATHS 7899";
      }
    })
  };

  const result = await scrapePage(page, "https://csstats.gg/player/example", "csstats", {
    maxAttempts: 2,
    readyTimeout: 10,
    navigationTimeout: 10,
    retryDelay: 0
  });

  assert.equal(result.fetch_status, "ready");
  assert.equal(result.metrics.kd, 1.42);
  assert.equal(reloads, 1);
});
