import { loadOwnRegistration, loadRegistrationSettings, submitRegistration } from "./registration-api.js";

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
let settings;
let countdownTimer;

function showToast(text, type = "info") {
  toast.textContent = text;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

function extractSteamId(value) {
  return String(value || "").match(/7656119\d{10}/)?.[0] || "";
}

function numberOrNull(value) {
  return value === "" ? null : Number(value);
}

function updatePreview() {
  const steamId = extractSteamId(form.elements.steam_profile.value);
  preview.hidden = !steamId;
  if (!steamId) return;
  const csstats = `https://csstats.gg/player/${steamId}`;
  const csrep = `https://csrep.gg/player/${steamId}`;
  document.getElementById("csstatsPreview").href = csstats;
  document.getElementById("csrepPreview").href = csrep;
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
  form.elements.consent.checked = true;
  submitButton.textContent = "Сохранить изменения";
  message.textContent = `Заявка уже создана · статус: ${data.status}`;
  updatePreview();
  updateFaceitEloVisibility();
  updateProgress();
}

form.addEventListener("input", () => { updatePreview(); updateProgress(); });
form.addEventListener("change", () => { updateFaceitEloVisibility(); updateProgress(); });

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const steamId = extractSteamId(form.elements.steam_profile.value);
  if (!steamId) {
    form.elements.steam_profile.setCustomValidity("Нужна ссылка с числовым SteamID64 или сам SteamID64");
    form.elements.steam_profile.reportValidity();
    return;
  }
  form.elements.steam_profile.setCustomValidity("");
  if (form.elements.faceit_level.value === "10" && !form.elements.faceit_elo.value) {
    form.elements.faceit_elo.setCustomValidity("Для 10 уровня укажи точное ELO");
    form.elements.faceit_elo.reportValidity();
    return;
  }
  form.elements.faceit_elo.setCustomValidity("");
  submitButton.disabled = true;
  message.textContent = "Сохраняем…";
  try {
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
    submitButton.textContent = "Сохранить изменения";
    message.textContent = "Заявка сохранена. Статистика появится после ближайшего обновления.";
    showToast(result.created ? "Заявка принята" : "Изменения сохранены");
  } catch (error) {
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
  fillForm(await loadOwnRegistration());
} catch (error) {
  stateBadge.textContent = "Нет подключения";
  message.textContent = error.message;
  showToast(error.message, "error");
}

window.addEventListener("beforeunload", () => window.clearInterval(countdownTimer));
updatePreview();
updateFaceitEloVisibility();
updateProgress();
