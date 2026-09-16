import { describeStep, getExpectedActor, getExpectedStep, getMap, getMapStatus, MAP_POOL } from "./veto-rules.js";
import { getRoomAccess, loadVetoRoom, sendVetoAction, subscribeVetoRoom } from "./veto-api.js";

const app = document.querySelector("#vetoApp");
const status = document.querySelector("#connectionStatus");
const roomCode = document.querySelector("#roomCode");
const roleBadge = document.querySelector("#roleBadge");
const toast = document.querySelector("#toast");
const { roomId, token } = getRoomAccess();

let snapshot;
let busy = false;
let coinFlipping = false;

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function setStatus(type, label) {
  status.dataset.status = type;
  status.lastChild.textContent = label;
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 3000);
}

function teamName(key) {
  if (!snapshot) return "Команда";
  return key === "team1" ? snapshot.team1Name : snapshot.team2Name;
}

function actorFor(actionActor) {
  return snapshot.callerRole === "admin" ? actionActor : undefined;
}

function canAct(actor) {
  return !busy && (snapshot.callerRole === actor || snapshot.callerRole === "admin");
}

function teamPanel(key) {
  const state = snapshot.state;
  const joined = Boolean(state.joined?.[key]);
  const role = state.roles?.teamA === key ? "Team A" : state.roles?.teamB === key ? "Team B" : "Роль не выбрана";
  const vote = state.formatVotes?.[key] ? `BO${state.formatVotes[key]}` : "Формат не выбран";
  const isTurn = getExpectedActor(state) === key || state.coin?.winner === key && state.phase === "role_choice" || key === "team1" && state.phase === "coin_call";
  return `<article class="captain-card ${joined ? "is-ready" : ""} ${isTurn ? "is-turn" : ""}">
    <div class="captain-index">${key === "team1" ? "01" : "02"}</div>
    <div class="captain-copy"><span>${esc(role)}</span><h2>${esc(teamName(key))}</h2><small>${joined ? vote : "Ожидаем капитана"}</small></div>
    <span class="ready-light" title="${joined ? "Подключён" : "Не подключён"}"></span>
  </article>`;
}

function formatControls() {
  const actor = snapshot.callerRole === "admin" ? null : snapshot.callerRole;
  const ownVote = actor ? snapshot.state.formatVotes?.[actor] : null;
  if (!actor) return `<p class="step-note">Капитаны независимо выбирают формат. Когда варианты совпадут, формат зафиксируется.</p>`;
  return `<div class="choice-grid choice-grid-three">${[1, 3, 5].map((value) => `<button class="choice-button ${ownVote === value ? "is-selected" : ""}" type="button" data-vote-format="${value}" ${busy ? "disabled" : ""}><strong>BO${value}</strong><span>${value === 1 ? "Одна карта" : value === 3 ? "До двух побед" : "До трёх побед"}</span></button>`).join("")}</div>
    <p class="step-note">Оба капитана должны выбрать одинаковый вариант.</p>`;
}

function centralStage() {
  const state = snapshot.state;
  if (state.phase === "waiting") {
    return `<span class="stage-chip">Подключение</span><h1>Ждём второго капитана</h1><p>Откройте обе персональные ссылки. Присутствие синхронизируется автоматически.</p>`;
  }
  if (state.phase === "format") {
    return `<span class="stage-chip">Шаг 1 · Формат</span><h1>Выберите формат серии</h1>${formatControls()}`;
  }
  if (state.phase === "coin_call") {
    const allowed = canAct("team1");
    return `<span class="stage-chip">Шаг 2 · Жеребьёвка</span><h1>${esc(teamName("team1"))}, ваш выбор</h1><div class="coin-zone">
      <div class="veto-coin"><span>MV</span></div>
      <div class="choice-grid"><button class="choice-button" type="button" data-coin="heads" ${allowed ? "" : "disabled"}><strong>Орёл</strong><span>Лицевая сторона</span></button><button class="choice-button" type="button" data-coin="tails" ${allowed ? "" : "disabled"}><strong>Решка</strong><span>Обратная сторона</span></button></div>
    </div><p class="step-note">Результат генерируется в базе и одинаков для обоих капитанов.</p>`;
  }
  if (state.phase === "role_choice") {
    const winner = state.coin.winner;
    const allowed = canAct(winner);
    const result = state.coin.result === "heads" ? "Орёл" : "Решка";
    return `<span class="stage-chip">Шаг 3 · Приоритет</span><h1>${esc(teamName(winner))} выигрывает жеребьёвку</h1><div class="coin-zone">
      <div class="veto-coin ${coinFlipping ? "is-flipping" : ""}"><span>${coinFlipping ? "?" : result}</span></div>
      <div><p class="coin-result">Выпал: <strong>${esc(result)}</strong></p><div class="choice-grid"><button class="choice-button" type="button" data-role="A" ${allowed ? "" : "disabled"}><strong>Team A</strong><span>Первый этап veto</span></button><button class="choice-button" type="button" data-role="B" ${allowed ? "" : "disabled"}><strong>Team B</strong><span>Ответный приоритет</span></button></div></div>
    </div><p class="step-note">Победитель выбирает роль A/B. Стартовая сторона выбирается отдельно для каждой карты по Major-порядку.</p>`;
  }
  if (state.phase === "complete") {
    return `<span class="stage-chip stage-chip-done">Veto завершён</span><h1>Карты готовы</h1><p>Итог серии синхронизирован у обоих капитанов. Можно переходить в игровой лобби.</p>`;
  }

  const step = getExpectedStep(state);
  const actor = getExpectedActor(state);
  const allowed = canAct(actor);
  if (step?.type === "side") {
    const map = getMap(state.series?.[step.mapNo - 1]?.map || remainingMap());
    return `<span class="stage-chip">Map veto · BO${state.format}</span><h1>${esc(teamName(actor))} выбирает сторону</h1><p class="focus-map">Карта ${step.mapNo}: <strong>${esc(map.name)}</strong></p><div class="choice-grid"><button class="choice-button side-ct" type="button" data-side="CT" ${allowed ? "" : "disabled"}><strong>CT</strong><span>Защита</span></button><button class="choice-button side-t" type="button" data-side="T" ${allowed ? "" : "disabled"}><strong>T</strong><span>Атака</span></button></div>`;
  }
  return `<span class="stage-chip">Map veto · BO${state.format}</span><h1>${esc(teamName(actor))}: ${step?.type === "pick" ? "выберите карту" : "забаньте карту"}</h1><p>${esc(describeStep(step))}. Нажмите на доступную карту ниже.</p><div class="turn-indicator"><span></span>Ход команды ${esc(teamName(actor))}</div>`;
}

function remainingMap() {
  const used = new Set(snapshot.state.actions.filter((item) => item.map).map((item) => item.map));
  return snapshot.state.mapPool.find((map) => !used.has(map));
}

function mapCards() {
  const state = snapshot.state;
  const step = getExpectedStep(state);
  const actor = getExpectedActor(state);
  const actionable = state.phase === "veto" && ["ban", "pick"].includes(step?.type) && canAct(actor);
  return MAP_POOL.map((map) => {
    const mapState = getMapStatus(state, map.id);
    const disabled = mapState !== "available" || !actionable;
    const action = state.actions.find((item) => item.map === map.id);
    const label = mapState === "ban" ? "Забанена" : mapState === "pick" ? "Выбрана" : mapState === "decider" ? "Решающая" : "Доступна";
    return `<button class="map-card map-tone-${map.tone} is-${mapState}" type="button" data-map="${map.id}" ${disabled ? "disabled" : ""}>
      <span class="map-code">${map.code}</span><span class="map-state">${label}</span><strong>${map.name}</strong><small>${action ? esc(teamName(action.by)) : "Active Duty"}</small>
    </button>`;
  }).join("");
}

function seriesCards() {
  const state = snapshot.state;
  const length = Number(state.format || 0);
  if (!length) return "";
  return Array.from({ length }, (_, index) => {
    const item = state.series?.[index];
    const map = item ? getMap(item.map) : null;
    return `<article class="series-card ${item ? "is-set" : ""}"><span>Карта ${index + 1}</span><strong>${map ? esc(map.name) : "Ожидается"}</strong><small>${item?.startingSide ? `${esc(teamName(item.sideChosenBy))} начинает за ${esc(item.startingSide)}` : item ? "Сторона не выбрана" : "—"}</small></article>`;
  }).join("");
}

function historyRows() {
  const state = snapshot.state;
  if (!state.actions.length) return `<p class="empty-history">История появится после первого бана.</p>`;
  return state.actions.map((action, index) => {
    const label = action.type === "ban" ? `банит ${getMap(action.map).name}` : action.type === "pick" ? `выбирает ${getMap(action.map).name}` : `выбирает ${action.side} на карте ${action.mapNo}`;
    return `<div class="history-row"><span>${String(index + 1).padStart(2, "0")}</span><strong>${esc(teamName(action.by))}</strong><p>${esc(label)}</p></div>`;
  }).join("");
}

function render() {
  const state = snapshot.state;
  roomCode.textContent = snapshot.code;
  roleBadge.textContent = snapshot.callerRole === "admin" ? "Организатор" : `Вы: ${teamName(snapshot.callerRole)}`;
  app.innerHTML = `<section class="captain-grid">${teamPanel("team1")}<div class="versus-mark">VS</div>${teamPanel("team2")}</section>
    <section class="veto-stage"><div class="stage-lighting" aria-hidden="true"></div><div class="stage-content">${centralStage()}</div></section>
    <section class="map-pool-section"><div class="veto-section-head"><div><span class="section-kicker">Active Duty · сентябрь 2026</span><h2>Пул карт</h2></div><span>${state.phase === "veto" ? describeStep(getExpectedStep(state)) : "7 карт"}</span></div><div class="map-grid">${mapCards()}</div></section>
    ${state.format ? `<section class="series-section"><div class="veto-section-head"><div><span class="section-kicker">Итог серии</span><h2>Порядок карт · BO${state.format}</h2></div></div><div class="series-grid">${seriesCards()}</div></section>` : ""}
    <section class="history-section"><div class="veto-section-head"><div><span class="section-kicker">Протокол комнаты</span><h2>История выбора</h2></div>${snapshot.callerRole === "admin" ? '<button class="button button-danger" type="button" data-reset>Сбросить комнату</button>' : ""}</div><div class="history-list">${historyRows()}</div></section>`;
}

async function refresh() {
  const next = await loadVetoRoom(roomId, token);
  if (!snapshot || next.revision > snapshot.revision) {
    const reveal = snapshot?.state?.coin?.result == null && next.state.coin?.result;
    snapshot = next;
    if (reveal) {
      coinFlipping = true;
      render();
      window.setTimeout(() => { coinFlipping = false; render(); }, 1500);
    } else render();
  }
}

async function act(action, successMessage = "Ход принят") {
  if (busy) return;
  busy = true;
  setStatus("saving", "Сохраняем ход");
  try {
    const previousCoin = snapshot.state.coin?.result;
    snapshot = await sendVetoAction(roomId, token, snapshot.revision, action);
    if (!previousCoin && snapshot.state.coin?.result) {
      coinFlipping = true;
      render();
      window.setTimeout(() => { coinFlipping = false; render(); }, 1500);
    } else render();
    setStatus("online", "Синхронизировано");
    if (successMessage) showToast(successMessage);
  } catch (error) {
    showToast(error.message || "Не удалось сохранить ход", "error");
    await refresh().catch(() => {});
    setStatus(error.code === "40001" ? "online" : "error", error.code === "40001" ? "Синхронизировано" : "Проверьте подключение");
  } finally {
    busy = false;
    if (snapshot) render();
  }
}

if (!roomId || !token) {
  app.innerHTML = `<section class="veto-empty"><span class="stage-chip">Нет доступа</span><h1>Нужна персональная ссылка комнаты</h1><p>Попросите организатора прислать ссылку капитана или создайте новую комнату.</p><a class="button button-primary" href="veto-admin.html">Создать комнату</a></section>`;
  setStatus("error", "Нет ссылки");
} else {
  try {
    snapshot = await loadVetoRoom(roomId, token);
    if (["team1", "team2"].includes(snapshot.callerRole) && !snapshot.state.joined?.[snapshot.callerRole] && ["waiting", "format"].includes(snapshot.state.phase)) {
      snapshot = await sendVetoAction(roomId, token, snapshot.revision, { type: "join" });
    }
    render();
    setStatus("online", "Синхронизировано");
    subscribeVetoRoom(roomId, (revision) => {
      if (revision > (snapshot?.revision || -1)) refresh().catch((error) => showToast(error.message, "error"));
    }, setStatus);
    window.setInterval(() => refresh().catch(() => {}), 10000);
  } catch (error) {
    app.innerHTML = `<section class="veto-empty"><span class="stage-chip">Ошибка доступа</span><h1>Комната не открылась</h1><p>${esc(error.message)}</p><a class="button button-primary" href="veto-admin.html">Создать новую</a></section>`;
    setStatus("error", "Ошибка комнаты");
  }
}

document.addEventListener("click", (event) => {
  const format = event.target.closest("[data-vote-format]");
  if (format) act({ type: "vote_format", format: Number(format.dataset.voteFormat) }, "Голос за формат принят");
  const coin = event.target.closest("[data-coin]");
  if (coin) act({ type: "coin_call", choice: coin.dataset.coin, actor: actorFor("team1") }, "Монетка подброшена");
  const role = event.target.closest("[data-role]");
  if (role) act({ type: "choose_role", role: role.dataset.role, actor: actorFor(snapshot.state.coin.winner) }, "Роль выбрана");
  const map = event.target.closest("[data-map]");
  if (map) {
    const step = getExpectedStep(snapshot.state);
    act({ type: step.type, map: map.dataset.map, actor: actorFor(getExpectedActor(snapshot.state)) }, step.type === "ban" ? "Карта забанена" : "Карта выбрана");
  }
  const side = event.target.closest("[data-side]");
  if (side) act({ type: "side", side: side.dataset.side, actor: actorFor(getExpectedActor(snapshot.state)) }, "Стартовая сторона выбрана");
  const reset = event.target.closest("[data-reset]");
  if (reset && window.confirm("Сбросить жеребьёвку и весь map veto в этой комнате?")) act({ type: "reset" }, "Комната сброшена");
});
