import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateStandings,
  createInitialState,
  derivePlayoffs,
  getMatchWinner,
  normalizeState
} from "../js/data.js";

test("new tournament has ten BO1 group matches and BO3 medal matches", () => {
  const state = createInitialState();
  assert.equal(state.regular.length, 10);
  assert.ok(state.regular.every((match) => match.maps.length === 1));
  assert.ok(state.semifinals.every((match) => match.maps.length === 3));
  assert.equal(state.thirdPlace.maps.length, 3);
  assert.equal(state.final.maps.length, 3);
});

test("playoff pairs and medal matches are derived from results", () => {
  const state = createInitialState();
  const winners = ["a", "d", "c", "a", "a", "c", "a", "d", "c", "b"];
  state.regular.forEach((match, index) => { match.maps[0].winner = winners[index]; });
  derivePlayoffs(state);

  assert.deepEqual(calculateStandings(state).map((team) => team.key), ["a", "c", "d", "b", "e"]);
  assert.deepEqual(state.semifinals.map(({ team1, team2 }) => [team1, team2]), [["a", "b"], ["c", "d"]]);

  state.semifinals[0].maps[0].winner = "a";
  state.semifinals[0].maps[1].winner = "a";
  state.semifinals[1].maps[0].winner = "d";
  state.semifinals[1].maps[1].winner = "d";
  derivePlayoffs(state);

  assert.equal(getMatchWinner(state.semifinals[0], "semifinal"), "a");
  assert.deepEqual([state.final.team1, state.final.team2], ["a", "d"]);
  assert.deepEqual([state.thirdPlace.team1, state.thirdPlace.team2], ["b", "c"]);
});

test("remote data is normalized to bounded safe values", () => {
  const state = createInitialState();
  state.teams.a.name = "X".repeat(100);
  state.regular[0].maps[0] = { winner: "outside", score1: 500, score2: -2, lobby: "x".repeat(800) };
  const normalized = normalizeState(state);

  assert.equal(normalized.teams.a.name.length, 48);
  assert.equal(normalized.regular[0].maps[0].winner, "");
  assert.equal(normalized.regular[0].maps[0].score1, "99");
  assert.equal(normalized.regular[0].maps[0].score2, "0");
  assert.equal(normalized.regular[0].maps[0].lobby.length, 500);
});
