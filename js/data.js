export const TEAM_KEYS = ["a", "b", "c", "d", "e"];

export const GROUP_SCHEDULE = [
  ["a", "b"], ["e", "d"], ["e", "c"], ["a", "e"], ["a", "d"],
  ["c", "d"], ["a", "c"], ["d", "b"], ["b", "c"], ["e", "b"]
];

export function createEmptyMap() {
  return { winner: "", score1: "", score2: "", lobby: "" };
}

export function createMatch(id, team1 = "", team2 = "", mapsCount = 3) {
  return {
    id,
    team1,
    team2,
    maps: Array.from({ length: mapsCount }, createEmptyMap)
  };
}

export function createInitialState() {
  return {
    version: 2,
    teams: Object.fromEntries(TEAM_KEYS.map((key) => [key, { name: "", logoUrl: "" }])),
    regular: GROUP_SCHEDULE.map(([team1, team2], index) => createMatch(index + 1, team1, team2, 1)),
    semifinals: [createMatch(1), createMatch(2)],
    thirdPlace: createMatch(1),
    final: createMatch(1)
  };
}

function cleanText(value, maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanTeam(value) {
  return {
    name: cleanText(value?.name, 48),
    logoUrl: cleanText(value?.logoUrl, 500)
  };
}

function normalizeMap(value, allowedTeams) {
  const winner = allowedTeams.includes(value?.winner) ? value.winner : "";
  const cleanScore = (score) => {
    if (score === "" || score === null || score === undefined) return "";
    const numeric = Number(score);
    return Number.isFinite(numeric) ? String(Math.max(0, Math.min(99, Math.trunc(numeric)))) : "";
  };

  return {
    winner,
    score1: cleanScore(value?.score1),
    score2: cleanScore(value?.score2),
    lobby: cleanText(value?.lobby, 500)
  };
}

function normalizeMatch(value, fallback, mapsCount) {
  const team1 = TEAM_KEYS.includes(value?.team1) ? value.team1 : fallback.team1;
  const team2 = TEAM_KEYS.includes(value?.team2) ? value.team2 : fallback.team2;
  const allowedTeams = [team1, team2].filter(Boolean);
  const maps = Array.isArray(value?.maps) ? value.maps : [];

  return {
    id: fallback.id,
    team1,
    team2,
    maps: Array.from({ length: mapsCount }, (_, index) => normalizeMap(maps[index], allowedTeams))
  };
}

export function normalizeState(value) {
  const fallback = createInitialState();
  const regular = Array.isArray(value?.regular) ? value.regular : [];
  const semifinals = Array.isArray(value?.semifinals) ? value.semifinals : [];

  const normalized = {
    version: 2,
    teams: Object.fromEntries(TEAM_KEYS.map((key) => [key, cleanTeam(value?.teams?.[key])])),
    regular: fallback.regular.map((match, index) => normalizeMatch(regular[index], match, 1)),
    semifinals: fallback.semifinals.map((match, index) => normalizeMatch(semifinals[index], match, 3)),
    thirdPlace: normalizeMatch(value?.thirdPlace, fallback.thirdPlace, 3),
    final: normalizeMatch(value?.final, fallback.final, 3)
  };

  derivePlayoffs(normalized);
  return normalized;
}

export function cloneState(state) {
  return normalizeState(structuredClone(state));
}

export function getTeamName(state, key) {
  if (!key) return "Определяется";
  return state.teams[key]?.name || `Команда ${key.toUpperCase()}`;
}

export function getTeamLogo(state, key) {
  return state.teams[key]?.logoUrl || "";
}

export function getSeriesScore(match) {
  const result = { left: 0, right: 0 };
  if (!match?.team1 || !match?.team2) return result;

  match.maps.forEach((map) => {
    if (map.winner === match.team1) result.left += 1;
    if (map.winner === match.team2) result.right += 1;
  });

  return result;
}

export function getMatchWinner(match, stage) {
  if (!match?.team1 || !match?.team2 || match.team1 === match.team2) return "";
  const need = stage === "regular" ? 1 : 2;
  const score = getSeriesScore(match);
  if (score.left >= need) return match.team1;
  if (score.right >= need) return match.team2;
  return "";
}

export function getMatchLoser(match, stage) {
  const winner = getMatchWinner(match, stage);
  if (!winner) return "";
  return winner === match.team1 ? match.team2 : match.team1;
}

export function calculateStandings(state) {
  const stats = Object.fromEntries(TEAM_KEYS.map((key) => [key, {
    key,
    played: 0,
    wins: 0,
    losses: 0,
    roundsFor: 0,
    roundsAgainst: 0,
    roundDiff: 0
  }]));

  state.regular.forEach((match) => {
    const winner = getMatchWinner(match, "regular");
    if (!winner) return;
    const loser = winner === match.team1 ? match.team2 : match.team1;
    const map = match.maps[0] || createEmptyMap();

    stats[match.team1].played += 1;
    stats[match.team2].played += 1;
    stats[winner].wins += 1;
    stats[loser].losses += 1;

    if (map.score1 !== "" && map.score2 !== "") {
      const score1 = Number(map.score1);
      const score2 = Number(map.score2);
      stats[match.team1].roundsFor += score1;
      stats[match.team1].roundsAgainst += score2;
      stats[match.team2].roundsFor += score2;
      stats[match.team2].roundsAgainst += score1;
    }
  });

  Object.values(stats).forEach((team) => {
    team.roundDiff = team.roundsFor - team.roundsAgainst;
  });

  return Object.values(stats).sort((left, right) => {
    if (right.wins !== left.wins) return right.wins - left.wins;
    if (right.roundDiff !== left.roundDiff) return right.roundDiff - left.roundDiff;
    return getTeamName(state, left.key).localeCompare(getTeamName(state, right.key), "ru");
  });
}

function clearMatch(match, mapsCount = 3) {
  match.maps = Array.from({ length: mapsCount }, createEmptyMap);
}

function setDerivedTeams(match, team1, team2) {
  if (match.team1 === team1 && match.team2 === team2) return;
  match.team1 = team1;
  match.team2 = team2;
  clearMatch(match, 3);
}

export function derivePlayoffs(state) {
  const groupComplete = state.regular.every((match) => Boolean(getMatchWinner(match, "regular")));

  if (!groupComplete) {
    state.semifinals.forEach((match) => setDerivedTeams(match, "", ""));
    setDerivedTeams(state.thirdPlace, "", "");
    setDerivedTeams(state.final, "", "");
    return state;
  }

  const standings = calculateStandings(state);
  setDerivedTeams(state.semifinals[0], standings[0].key, standings[3].key);
  setDerivedTeams(state.semifinals[1], standings[1].key, standings[2].key);

  const winner1 = getMatchWinner(state.semifinals[0], "semifinal");
  const winner2 = getMatchWinner(state.semifinals[1], "semifinal");
  const loser1 = getMatchLoser(state.semifinals[0], "semifinal");
  const loser2 = getMatchLoser(state.semifinals[1], "semifinal");

  setDerivedTeams(state.final, winner1, winner2);
  setDerivedTeams(state.thirdPlace, loser1, loser2);
  return state;
}

export function getMatch(state, stage, id = 1) {
  if (stage === "regular") return state.regular.find((match) => match.id === id);
  if (stage === "semifinal") return state.semifinals.find((match) => match.id === id);
  if (stage === "thirdPlace") return state.thirdPlace;
  if (stage === "final") return state.final;
  return undefined;
}

export function getCurrentMatch(state) {
  const regular = state.regular.find((match) => !getMatchWinner(match, "regular"));
  if (regular) return { match: regular, stage: "regular", label: "Групповой этап", format: "BO1" };

  const semifinal = state.semifinals.find((match) => match.team1 && match.team2 && !getMatchWinner(match, "semifinal"));
  if (semifinal) return { match: semifinal, stage: "semifinal", label: "Полуфинал", format: "BO3" };

  if (state.thirdPlace.team1 && state.thirdPlace.team2 && !getMatchWinner(state.thirdPlace, "thirdPlace")) {
    return { match: state.thirdPlace, stage: "thirdPlace", label: "За третье место", format: "BO3" };
  }

  if (state.final.team1 && state.final.team2 && !getMatchWinner(state.final, "final")) {
    return { match: state.final, stage: "final", label: "Финал", format: "BO3" };
  }

  return null;
}
