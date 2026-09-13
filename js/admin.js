import { TEAM_KEYS, cloneState, createInitialState, derivePlayoffs, getMatch } from "./data.js";
import { renderAdmin } from "./render.js?v=20260913b";
import { loadTournament, saveTournament, subscribeTournament, uploadTeamLogo } from "./supabase.js";

const status = document.getElementById("connectionStatus");
const toast = document.getElementById("toast");
const resetButton = document.getElementById("resetTournament");
const saveTeamsButton = document.getElementById("saveTeams");
let currentState = createInitialState();
let revision = 0;
let saving = false;

function setStatus(type, message) {
  status.dataset.status = type;
  status.lastChild.textContent = message;
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function setBusy(value) {
  saving = value;
  resetButton.disabled = value;
  saveTeamsButton.disabled = value;
}

async function reloadAfterConflict(message) {
  const snapshot = await loadTournament();
  currentState = snapshot.state;
  revision = snapshot.revision;
  renderAdmin(currentState);
  showToast(message, "error");
}

async function commit(mutator, successMessage = "Сохранено") {
  if (saving) return;
  const nextState = cloneState(currentState);
  mutator(nextState);
  derivePlayoffs(nextState);

  setBusy(true);
  setStatus("saving", "Сохранение");
  try {
    const snapshot = await saveTournament(nextState, revision);
    currentState = snapshot.state;
    revision = snapshot.revision;
    renderAdmin(currentState);
    setStatus("online", "Синхронизировано");
    showToast(successMessage);
  } catch (error) {
    if (error.code === "CONFLICT") {
      await reloadAfterConflict(error.message);
    } else {
      setStatus("error", "Ошибка сохранения");
      showToast(error.message, "error");
    }
  } finally {
    setBusy(false);
  }
}

renderAdmin(currentState);

try {
  subscribeTournament(
    (snapshot) => {
      if (saving || snapshot.revision <= revision) return;
      currentState = snapshot.state;
      revision = snapshot.revision;
      renderAdmin(currentState);
    },
    (type, message) => {
      setStatus(type, message);
      if (type === "error") showToast(message, "error");
    }
  );
} catch (error) {
  setStatus("error", "Нет подключения");
  showToast(error.message, "error");
}

saveTeamsButton.addEventListener("click", () => {
  const names = Object.fromEntries(TEAM_KEYS.map((key) => [key, document.querySelector(`[data-team-name="${key}"]`).value]));
  commit((state) => {
    TEAM_KEYS.forEach((key) => { state.teams[key].name = names[key].trim().slice(0, 48); });
  }, "Команды обновлены");
});

resetButton.addEventListener("click", () => {
  const confirmed = window.confirm("Удалить все команды, логотипы из сетки и результаты матчей? Загруженные файлы останутся в Storage и будут перезаписаны при новой загрузке.");
  if (confirmed) commit((state) => Object.assign(state, createInitialState()), "Новый турнир создан");
});

document.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="map-winner"]');
  if (!button) return;
  const stage = button.dataset.stage;
  const matchId = Number(button.dataset.match);
  const mapIndex = Number(button.dataset.map);
  const winner = button.dataset.winner;

  commit((state) => {
    const match = getMatch(state, stage, matchId);
    if (match?.maps[mapIndex]) match.maps[mapIndex].winner = winner;
  }, "Победитель карты сохранён");
});

document.addEventListener("change", async (event) => {
  const target = event.target;

  if (target.matches("[data-score]")) {
    const stage = target.dataset.stage;
    const matchId = Number(target.dataset.match);
    const mapIndex = Number(target.dataset.map);
    const side = target.dataset.score;
    const value = target.value === "" ? "" : String(Math.max(0, Math.min(99, Math.trunc(Number(target.value) || 0))));
    await commit((state) => {
      const match = getMatch(state, stage, matchId);
      if (match?.maps[mapIndex]) match.maps[mapIndex][side] = value;
    }, "Счёт обновлён");
  }

  if (target.matches("[data-lobby]")) {
    const stage = target.dataset.stage;
    const matchId = Number(target.dataset.match);
    const mapIndex = Number(target.dataset.map);
    const value = target.value.trim().slice(0, 500);
    await commit((state) => {
      const match = getMatch(state, stage, matchId);
      if (match?.maps[mapIndex]) match.maps[mapIndex].lobby = value;
    }, "Ссылка обновлена");
  }

  if (target.matches("[data-team-logo]") && target.files?.[0]) {
    const key = target.dataset.teamLogo;
    setBusy(true);
    setStatus("saving", "Загрузка логотипа");
    try {
      const logoUrl = await uploadTeamLogo(key, target.files[0]);
      setBusy(false);
      await commit((state) => { state.teams[key].logoUrl = logoUrl; }, "Логотип обновлён");
    } catch (error) {
      setBusy(false);
      setStatus("error", "Ошибка загрузки");
      showToast(error.message, "error");
    }
  }
});
