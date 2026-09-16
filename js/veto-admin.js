import { getTeamName } from "./data.js";
import { loadTournament } from "./supabase.js";
import { createVetoRoom } from "./veto-api.js";

const form = document.querySelector("#roomForm");
const team1 = document.querySelector("#roomTeam1");
const team2 = document.querySelector("#roomTeam2");
const suggestions = document.querySelector("#teamSuggestions");
const result = document.querySelector("#roomResult");
const createButton = document.querySelector("#createRoom");
const toast = document.querySelector("#toast");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function showToast(message, type = "success") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
}

function roomLink(roomId, token) {
  const url = new URL("veto.html", window.location.href);
  url.searchParams.set("room", roomId);
  url.searchParams.set("token", token);
  return url.href;
}

function accessCard(label, detail, url, accent = "") {
  return `<article class="access-card ${accent}">
    <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(detail)}</strong></div>
    <div class="access-actions"><a class="button button-ghost" href="${escapeHtml(url)}">Открыть</a><button class="button button-primary" type="button" data-copy="${escapeHtml(url)}">Копировать</button></div>
  </article>`;
}

try {
  const snapshot = await loadTournament();
  const names = Object.keys(snapshot.state.teams).map((key) => getTeamName(snapshot.state, key)).filter((name) => !name.startsWith("Команда "));
  suggestions.innerHTML = names.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("");
  if (names[0]) team1.value = names[0];
  if (names[1]) team2.value = names[1];
} catch {
  // Комнату можно создать и без загруженного турнирного списка.
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  createButton.disabled = true;
  createButton.textContent = "Создаём комнату…";
  try {
    const room = await createVetoRoom(team1.value, team2.value);
    const adminUrl = roomLink(room.roomId, room.adminToken);
    const team1Url = roomLink(room.roomId, room.team1Token);
    const team2Url = roomLink(room.roomId, room.team2Token);
    result.hidden = false;
    result.innerHTML = `<div class="room-created-head"><div><span class="section-kicker">Комната готова</span><h2>${escapeHtml(room.code)}</h2></div><p>Ссылки действуют 7 дней. Перешлите капитанам только их личные ссылки.</p></div>
      <div class="access-list">
        ${accessCard("Капитан 1", team1.value.trim(), team1Url, "access-card-team1")}
        ${accessCard("Капитан 2", team2.value.trim(), team2Url, "access-card-team2")}
        ${accessCard("Организатор", "Наблюдение и сброс", adminUrl, "access-card-admin")}
      </div>`;
    result.scrollIntoView({ behavior: "smooth", block: "start" });
    showToast("Комната создана");
  } catch (error) {
    showToast(error.message || "Не удалось создать комнату", "error");
  } finally {
    createButton.disabled = false;
    createButton.textContent = "Создать комнату";
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    showToast("Ссылка скопирована");
  } catch {
    window.prompt("Скопируйте ссылку", button.dataset.copy);
  }
});
