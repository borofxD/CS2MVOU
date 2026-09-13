import {
  TEAM_KEYS,
  calculateStandings,
  derivePlayoffs,
  getCurrentMatch,
  getMatchWinner,
  getSeriesScore,
  getTeamLogo,
  getTeamName
} from "./data.js?v=20260913c";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CS";
}

function avatar(state, key, large = false) {
  const name = getTeamName(state, key);
  const logo = safeUrl(getTeamLogo(state, key));
  const className = `team-avatar${large ? " team-avatar-large" : ""}`;
  return logo
    ? `<span class="${className}"><img src="${escapeHtml(logo)}" alt="" loading="lazy"></span>`
    : `<span class="${className}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function teamInline(state, key, large = false) {
  return `<span class="team-inline">${avatar(state, key, large)}<strong>${escapeHtml(getTeamName(state, key))}</strong></span>`;
}

function mapRoundScore(map) {
  return map.score1 !== "" && map.score2 !== "" ? `${map.score1}:${map.score2}` : "—";
}

function renderHero(state) {
  const current = getCurrentMatch(state);
  const finalWinner = getMatchWinner(state.final, "final");
  const stage = document.getElementById("heroStage");
  const title = document.getElementById("heroMatch");
  const meta = document.getElementById("heroMeta");
  const teams = document.getElementById("heroTeams");

  if (current) {
    const score = getSeriesScore(current.match);
    stage.textContent = current.label;
    title.textContent = `${getTeamName(state, current.match.team1)} vs ${getTeamName(state, current.match.team2)}`;
    meta.textContent = current.stage === "regular"
      ? `Матч #${current.match.id} · ${current.format} · одна карта`
      : `${current.format} · серия ${score.left}:${score.right}`;
    teams.innerHTML = `${teamInline(state, current.match.team1, true)}<span class="hero-versus">VS</span>${teamInline(state, current.match.team2, true)}`;
    return;
  }

  if (finalWinner) {
    stage.textContent = "Чемпион турнира";
    title.textContent = getTeamName(state, finalWinner);
    meta.textContent = "Финальная серия завершена";
    teams.innerHTML = teamInline(state, finalWinner, true);
    return;
  }

  stage.textContent = "Ожидание турнира";
  title.textContent = "Новый турнир";
  meta.textContent = "Добавьте команды и результаты на странице редактирования.";
  teams.innerHTML = "";
}

function renderTeamStrip(state) {
  document.getElementById("teamStrip").innerHTML = TEAM_KEYS.map((key) => `
    <div class="team-chip">${avatar(state, key)}<strong>${escapeHtml(getTeamName(state, key))}</strong></div>
  `).join("");
}

function renderStandings(state) {
  const standings = calculateStandings(state);
  document.getElementById("standingsBody").innerHTML = standings.map((team, index) => {
    return `
      <tr class="${index < 4 ? "is-qualified" : ""}">
        <td class="rank">${index + 1}</td>
        <td>${teamInline(state, team.key)}</td>
        <td>${team.played}</td>
        <td>${team.wins}</td>
        <td>${team.losses}</td>
        <td class="points-cell">${team.points}</td>
      </tr>
    `;
  }).join("");
}

function renderGroupResults(state) {
  const current = getCurrentMatch(state);
  document.getElementById("groupResults").innerHTML = state.regular.map((match) => {
    const winner = getMatchWinner(match, "regular");
    const map = match.maps[0];
    const isLive = current?.stage === "regular" && current.match.id === match.id;
    return `
      <div class="result-row ${isLive ? "is-live" : ""}">
        <span class="result-number">${String(match.id).padStart(2, "0")}</span>
        <span class="result-teams">${escapeHtml(getTeamName(state, match.team1))} — ${escapeHtml(getTeamName(state, match.team2))}</span>
        <span class="result-score"><strong>${escapeHtml(mapRoundScore(map))}</strong><span class="result-state">${winner ? escapeHtml(getTeamName(state, winner)) : "Ожидает"}</span></span>
      </div>
    `;
  }).join("");
}

function readonlyMatch(state, match, stage, label) {
  const winner = getMatchWinner(match, stage);
  const score = getSeriesScore(match);
  const ready = Boolean(match.team1 && match.team2);
  const maps = match.maps.map((map, index) => {
    const lobby = safeUrl(map.lobby);
    const content = `К${index + 1} · ${escapeHtml(mapRoundScore(map))}`;
    return lobby ? `<a class="map-pill" href="${escapeHtml(lobby)}" target="_blank" rel="noopener noreferrer">${content} ↗</a>` : `<span class="map-pill">${content}</span>`;
  }).join("");

  return `
    <article class="readonly-match ${ready && !winner ? "is-live" : ""}">
      <div class="readonly-match-meta"><span>${escapeHtml(label)}</span><span>${winner ? "Завершён" : ready ? "Ожидает результата" : "Пары определяются"}</span></div>
      <div class="readonly-team ${winner && winner === match.team1 ? "is-winner" : ""}">${teamInline(state, match.team1)}<span class="series-score">${score.left}</span></div>
      <div class="readonly-team ${winner && winner === match.team2 ? "is-winner" : ""}">${teamInline(state, match.team2)}<span class="series-score">${score.right}</span></div>
      <div class="map-summary">${maps}</div>
    </article>
  `;
}

function renderPlayoffs(state) {
  document.getElementById("semifinalView").innerHTML = state.semifinals.map((match, index) => readonlyMatch(state, match, "semifinal", `Полуфинал ${index + 1}`)).join("");
  document.getElementById("thirdPlaceView").innerHTML = readonlyMatch(state, state.thirdPlace, "thirdPlace", "Матч за 3-е место");
  document.getElementById("finalView").innerHTML = readonlyMatch(state, state.final, "final", "Финал");
}

export function renderPublic(state) {
  derivePlayoffs(state);
  const completed = state.regular.filter((match) => getMatchWinner(match, "regular")).length;
  document.getElementById("groupProgress").textContent = `${completed} / ${state.regular.length}`;
  renderHero(state);
  renderTeamStrip(state);
  renderStandings(state);
  renderGroupResults(state);
  renderPlayoffs(state);
}

function teamEditorCard(state, key) {
  const name = getTeamName(state, key);
  return `
    <article class="team-editor-card">
      <div class="team-editor-preview">${avatar(state, key, true)}<strong>${escapeHtml(name)}</strong></div>
      <label class="field-label" for="team-${key}">Название команды ${key.toUpperCase()}</label>
      <input class="text-field" id="team-${key}" data-team-name="${key}" maxlength="48" value="${escapeHtml(state.teams[key].name)}" placeholder="Команда ${key.toUpperCase()}">
      <span class="field-label">Логотип</span>
      <label class="file-button" for="logo-${key}">Выбрать изображение</label>
      <input class="file-field" id="logo-${key}" data-team-logo="${key}" type="file" accept="image/png,image/jpeg,image/webp">
    </article>
  `;
}

function matchEditor(state, match, stage, label) {
  const winner = getMatchWinner(match, stage);
  const ready = Boolean(match.team1 && match.team2);
  const team1 = getTeamName(state, match.team1);
  const team2 = getTeamName(state, match.team2);
  const score = getSeriesScore(match);

  if (!ready) {
    return `<article class="match-editor"><div class="match-editor-head"><span>${escapeHtml(label)}</span><strong>Пары определяются</strong></div><div class="empty-match">Завершите предыдущий этап</div></article>`;
  }

  const maps = match.maps.map((map, mapIndex) => {
    const lobby = safeUrl(map.lobby);
    return `
      <div class="map-editor">
        <div class="map-editor-top">
          <span class="map-editor-label">Карта ${mapIndex + 1}</span>
          <div class="score-fields">
            <input class="score-field" type="number" min="0" max="99" inputmode="numeric" aria-label="Счёт ${escapeHtml(team1)}, карта ${mapIndex + 1}" data-score="score1" data-stage="${stage}" data-match="${match.id}" data-map="${mapIndex}" value="${escapeHtml(map.score1)}" placeholder="–">
            <span>:</span>
            <input class="score-field" type="number" min="0" max="99" inputmode="numeric" aria-label="Счёт ${escapeHtml(team2)}, карта ${mapIndex + 1}" data-score="score2" data-stage="${stage}" data-match="${match.id}" data-map="${mapIndex}" value="${escapeHtml(map.score2)}" placeholder="–">
          </div>
        </div>
        <div class="winner-buttons">
          <button class="winner-button ${map.winner === match.team1 ? "is-selected" : ""}" type="button" data-action="map-winner" data-stage="${stage}" data-match="${match.id}" data-map="${mapIndex}" data-winner="${match.team1}">${escapeHtml(team1)}</button>
          <button class="winner-button ${map.winner === match.team2 ? "is-selected" : ""}" type="button" data-action="map-winner" data-stage="${stage}" data-match="${match.id}" data-map="${mapIndex}" data-winner="${match.team2}">${escapeHtml(team2)}</button>
        </div>
        <div class="lobby-row">
          <input class="text-field" type="url" inputmode="url" aria-label="Ссылка на лобби, карта ${mapIndex + 1}" data-lobby data-stage="${stage}" data-match="${match.id}" data-map="${mapIndex}" value="${escapeHtml(map.lobby)}" placeholder="https://…">
          ${lobby ? `<a class="lobby-link" href="${escapeHtml(lobby)}" target="_blank" rel="noopener noreferrer" aria-label="Открыть лобби">↗</a>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <article class="match-editor ${!winner ? "is-live" : ""}">
      <div class="match-editor-head"><span>${escapeHtml(label)}</span><strong class="match-editor-team">${escapeHtml(team1)} · ${score.left}:${score.right} · ${escapeHtml(team2)}</strong></div>
      <div class="match-editor-body">${maps}</div>
    </article>
  `;
}

export function renderAdmin(state) {
  derivePlayoffs(state);
  const completed = state.regular.filter((match) => getMatchWinner(match, "regular")).length;
  document.getElementById("adminGroupProgress").textContent = `${completed} / ${state.regular.length}`;
  document.getElementById("teamEditor").innerHTML = TEAM_KEYS.map((key) => teamEditorCard(state, key)).join("");
  document.getElementById("regularEditor").innerHTML = state.regular.map((match) => matchEditor(state, match, "regular", `Матч ${match.id} · BO1`)).join("");
  document.getElementById("semifinalEditor").innerHTML = state.semifinals.map((match, index) => matchEditor(state, match, "semifinal", `Полуфинал ${index + 1} · BO3`)).join("");
  document.getElementById("thirdPlaceEditor").innerHTML = matchEditor(state, state.thirdPlace, "thirdPlace", "3-е место · BO3");
  document.getElementById("finalEditor").innerHTML = matchEditor(state, state.final, "final", "Финал · BO3");
}
