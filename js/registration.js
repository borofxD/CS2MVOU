import { loadOwnRegistration, loadRegistrationSettings, submitRegistration } from "./registration-api.js";
import { extractSteamId64, resolveSteamId64 } from "./steam-profile.js";

const form = document.getElementById("registrationForm");
const submitButton = document.getElementById("registrationSubmit");
const stateBadge = document.getElementById("registrationState");
const countdown = document.getElementById("registrationCountdown");
const deadline = document.getElementById("registrationDeadline");
const message = document.getElementById("registrationMessage");
const toast = document.getElementById("toast");
const progressBar = document.getElementById("formProgressBar");
const progressLabel = document.getElementById("formProgressLabel");
const preview = document.getElementById("profilePreview");
const steamProfileHint = document.getElementById("steamProfileHint");
const successPanel = document.getElementById("registrationSuccess");
const successTitle = document.getElementById("registrationSuccessTitle");
const successMessage = document.getElementById("registrationSuccessMessage");
const successStatus = document.getElementById("registrationSuccessStatus");
const successSteam = document.getElementById("registrationSuccessSteam");
const editRegistrationButton = document.getElementById("editRegistration");
let settings;
let countdownTimer;
let resolvedProfile = { input: "", steamId: "" };
let currentRegistration;

const statusLabels = {
  pending: "На проверке",
  approved: "Подтверждена",
  rejected: "Нужно исправить"
};

function showToast(text, type = "info") {
  toast.textContent = text;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function updatePreview(steamId = extractSteamId64(form.elements.steam_profile.value)) {
  preview.hidden = !steamId;
  if (!steamId) return;
  const csstats = `https://csstats.gg/player/${steamId}`;
  const csrep = `https://csrep.gg/player/${steamId}`;
  document.getElementById("csstatsPreview").href = csstats;
  document.getElementById("csrepPreview").href = csrep;
}

async function resolveSteamProfile({ quiet = false } = {}) {
  const input = form.elements.steam_profile.value.trim();
  if (!input) return "";
  if (resolvedProfile.input === input && resolvedProfile.steamId) return resolvedProfile.steamId;
  if (!quiet) steamProfileHint.textContent = "Определяем SteamID64…";
  const steamId = await resolveSteamId64(input);
  resolvedProfile = { input, steamId };
  steamProfileHint.textContent = `SteamID64 найден: ${steamId}`;
  form.elements.steam_profile.setCustomValidity("");
  updatePreview(steamId);
  return steamId;
}

function updateProgress() {
  const required = ["cs_nick", "teams_nick", "country_code", "steam_profile"];
  let completed = required.filter((name) => form.elements[name].value.trim()).length;
  if (form.elements.faceit_level.value || form.elements.premier_rating.value) completed += 1;
  if (form.elements.consent.checked) completed += 1;
  progressLabel.textContent = `${completed} / 6`;
  progressBar.style.width = `${Math.round((completed / 6) * 100)}%`;
}

function updateFaceitEloVisibility() {
  const exact = form.elements.faceit_level.value === "10";
  document.getElementById("faceitEloField").hidden = !exact;
  form.elements.faceit_elo.required = exact;
  if (!exact) form.elements.faceit_elo.value = "";
}

function updateCountdown() {
  if (!settings?.closes_at) return;
  const remaining = new Date(settings.closes_at).getTime() - Date.now();
  const open = settings.enabled && remaining > 0 && (!settings.opens_at || Date.now() >= new Date(settings.opens_at).getTime());
  form.toggleAttribute("inert", !open);
  submitButton.disabled = !open;
  editRegistrationButton.disabled = !open;
  stateBadge.textContent = open ? "Регистрация открыта" : "Регистрация закрыта";
  stateBadge.dataset.state = open ? "open" : "closed";
  if (remaining <= 0) {
    countdown.textContent = "Закрыта";
    return;
  }
  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  countdown.textContent = days ? `${days} дн. ${hours} ч.` : `${hours} ч. ${minutes} мин.`;
}

function fillForm(data) {
  if (!data) return;
  ["cs_nick", "teams_nick", "country_code", "faceit_level", "faceit_elo", "premier_rating", "faceit_url", "primary_role", "secondary_role"].forEach((key) => {
    if (form.elements[key] && data[key] != null) form.elements[key].value = data[key];
  });
  form.elements.steam_profile.value = data.steam_id || "";
  resolvedProfile = { input: data.steam_id || "", steamId: data.steam_id || "" };
  form.elements.consent.checked = true;
  submitButton.textContent = "Сохранить изменения";
  message.textContent = `Заявка уже создана · статус: ${data.status}`;
  updatePreview();
  updateFaceitEloVisibility();
  updateProgress();
}

function resetVisibleForm() {
  form.reset();
  resolvedProfile = { input: "", steamId: "" };
  form.elements.steam_profile.setCustomValidity("");
  form.elements.faceit_elo.setCustomValidity("");
  steamProfileHint.textContent = "Можно вставить SteamID64 или ссылку вида steamcommunity.com/id/твой_ник.";
  submitButton.textContent = "Отправить заявку";
  message.textContent = "";
  updatePreview();
  updateFaceitEloVisibility();
  updateProgress();
}

function showConfirmation(data, created = false) {
  currentRegistration = data;
  resetVisibleForm();
  form.hidden = true;
  successPanel.hidden = false;
  successTitle.textContent = created ? "Заявка отправлена" : "Заявка уже создана";
  successMessage.textContent = created
    ? "Данные приняты и синхронизированы. Статистика появится после ближайшего обновления."
    : "Твои данные сохранены. При необходимости заявку можно открыть и изменить.";
  successStatus.textContent = statusLabels[data?.status] || data?.status || "На проверке";
  successSteam.textContent = data?.steam_id || "—";
}

function openEditMode() {
  if (!currentRegistration) return;
  successPanel.hidden = true;
  form.hidden = false;
  fillForm(currentRegistration);
  form.elements.cs_nick.focus();
}

form.addEventListener("input", (event) => {
  if (event.target === form.elements.steam_profile) {
    resolvedProfile = { input: "", steamId: "" };
    form.elements.steam_profile.setCustomValidity("");
    steamProfileHint.textContent = "Можно вставить SteamID64 или ссылку вида steamcommunity.com/id/твой_ник.";
  }
  updatePreview();
  updateProgress();
});
form.addEventListener("change", () => { updateFaceitEloVisibility(); updateProgress(); });
form.elements.steam_profile.addEventListener("blur", async () => {
  if (!form.elements.steam_profile.value.trim() || extractSteamId64(form.elements.steam_profile.value)) return;
  try {
    await resolveSteamProfile();
  } catch (error) {
    steamProfileHint.textContent = error.message;
  }
});
editRegistrationButton.addEventListener("click", openEditMode);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  form.elements.steam_profile.setCustomValidity("");
  if (form.elements.faceit_level.value === "10" && !form.elements.faceit_elo.value) {
    form.elements.faceit_elo.setCustomValidity("Для 10 уровня укажи точное ELO");
    form.elements.faceit_elo.reportValidity();
    return;
  }
  form.elements.faceit_elo.setCustomValidity("");
  submitButton.disabled = true;
  message.textContent = "Проверяем Steam-профиль…";
  try {
    const steamId = await resolveSteamProfile({ quiet: true });
    message.textContent = "Сохраняем…";
    const result = await submitRegistration({
      cs_nick: form.elements.cs_nick.value.trim(),
      teams_nick: form.elements.teams_nick.value.trim(),
      country_code: form.elements.country_code.value,
      steam_id: steamId,
      faceit_level: numberOrNull(form.elements.faceit_level.value),
      faceit_elo: numberOrNull(form.elements.faceit_elo.value),
      premier_rating: numberOrNull(form.elements.premier_rating.value),
      faceit_url: form.elements.faceit_url.value.trim() || null,
      primary_role: form.elements.primary_role.value,
      secondary_role: form.elements.secondary_role.value || null
    });
    const saved = await loadOwnRegistration();
    showConfirmation(saved || { ...result, steam_id: steamId, status: "pending" }, result.created);
    showToast(result.created ? "Заявка принята" : "Изменения сохранены");
  } catch (error) {
    if (!resolvedProfile.steamId) {
      form.elements.steam_profile.setCustomValidity(error.message);
      form.elements.steam_profile.reportValidity();
    }
    message.textContent = error.message;
    showToast(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

try {
  settings = await loadRegistrationSettings();
  deadline.textContent = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date(settings.closes_at));
  updateCountdown();
  countdownTimer = window.setInterval(updateCountdown, 30000);
  const ownRegistration = await loadOwnRegistration();
  if (ownRegistration) showConfirmation(ownRegistration);
} catch (error) {
  stateBadge.textContent = "Нет подключения";
  message.textContent = error.message;
  showToast(error.message, "error");
}

window.addEventListener("beforeunload", () => window.clearInterval(countdownTimer));
updatePreview();
updateFaceitEloVisibility();
updateProgress();
