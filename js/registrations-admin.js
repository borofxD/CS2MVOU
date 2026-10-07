import { getRegistrationClient, sha256 } from "./registration-api.js";
import { TOURNAMENT_ID } from "./config.js";

const client = getRegistrationClient();
const list = document.getElementById("registrationAdminList");
const status = document.getElementById("registrationAdminStatus");
let settings;
let registrations = [];
let adminToken = sessionStorage.getItem("mvou-registration-admin-token") || "";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const localInputValue = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
const normalizeAdminToken = (value) => String(value || "").trim().replace(/^`+|`+$/g, "").replace(/\s+/g, "");

function renderRegistrations() {
  status.textContent = `${registrations.length} заявок · ${registrations.filter((row) => row.status === "approved").length} подтверждено · ${registrations.filter((row) => row.mv_rating != null).length} рассчитано`;
  list.innerHTML = registrations.length ? registrations.map((row) => `<article class="registration-admin-row">
    <div><strong>${escapeHtml(row.cs_nick)}</strong><small>${escapeHtml(row.teams_nick)} · ${escapeHtml(row.country_code)} · ${row.faceit_level ? `FACEIT ${row.faceit_level}` : "без FACEIT"}${row.premier_rating ? ` · ${Number(row.premier_rating).toLocaleString("ru-RU")}` : ""}</small></div>
    <div class="registration-source-state"><span data-state="${escapeHtml(row.scrape_status)}">${escapeHtml(row.scrape_status || "queued")}</span><a href="${escapeHtml(row.csstats_url)}" target="_blank" rel="noopener">CSStats</a><a href="${escapeHtml(row.csrep_url)}" target="_blank" rel="noopener">CSRep</a></div>
    <div class="admin-rating"><small>MV</small><strong>${row.mv_rating == null ? "—" : Math.round(row.mv_rating)}</strong></div>
    <select data-registration-status="${row.id}"><option value="pending" ${row.status === "pending" ? "selected" : ""}>Ожидает</option><option value="approved" ${row.status === "approved" ? "selected" : ""}>Подтверждён</option><option value="rejected" ${row.status === "rejected" ? "selected" : ""}>Отклонён</option></select>
  </article>`).join("") : '<div class="empty-state">Заявок пока нет.</div>';
}

async function loadAdminData() {
  if (!adminToken) return;
  const tokenHash = await sha256(adminToken);
  const [{ data: settingsData, error: settingsError }, { data: registrationData, error: registrationError }] = await Promise.all([
    client.from("registration_settings").select("*").eq("tournament_id", TOURNAMENT_ID).single(),
    client.rpc("admin_get_registration_overview", { p_admin_token_hash: tokenHash })
  ]);
  if (settingsError) throw settingsError;
  if (registrationError) throw registrationError;
  settings = settingsData;
  registrations = registrationData || [];
  document.getElementById("registrationOpensAt").value = localInputValue(settings.opens_at);
  document.getElementById("registrationClosesAt").value = localInputValue(settings.closes_at);
  document.getElementById("registrationTeamCount").value = settings.team_count;
  document.getElementById("registrationTeamSize").value = settings.team_size;
  document.getElementById("registrationEnabled").checked = settings.enabled;
  document.getElementById("ratingsPublished").checked = settings.ratings_published;
  renderRegistrations();
  document.getElementById("registrationManagement").hidden = false;
  document.getElementById("registrationAccessMessage").textContent = "Управление регистрацией открыто до закрытия вкладки.";
}

document.getElementById("unlockRegistrationAdmin").addEventListener("click", async () => {
  adminToken = normalizeAdminToken(document.getElementById("registrationAdminToken").value);
  if (!adminToken) return;
  if (!/^[0-9a-f]{64}$/i.test(adminToken)) {
    document.getElementById("registrationAccessMessage").textContent = "Ключ организатора должен состоять из 64 символов без кавычек.";
    return;
  }
  sessionStorage.setItem("mvou-registration-admin-token", adminToken);
  try {
    await loadAdminData();
    document.getElementById("registrationAdminToken").value = "";
  } catch (error) {
    sessionStorage.removeItem("mvou-registration-admin-token");
    adminToken = "";
    document.getElementById("registrationAccessMessage").textContent = error.message;
  }
});

document.getElementById("saveRegistrationSettings").addEventListener("click", async () => {
  const payload = {
    opens_at: new Date(document.getElementById("registrationOpensAt").value).toISOString(),
    closes_at: new Date(document.getElementById("registrationClosesAt").value).toISOString(),
    team_count: Number(document.getElementById("registrationTeamCount").value),
    team_size: Number(document.getElementById("registrationTeamSize").value),
    enabled: document.getElementById("registrationEnabled").checked,
    ratings_published: document.getElementById("ratingsPublished").checked,
    updated_at: new Date().toISOString()
  };
  const { error } = await client.rpc("admin_update_registration_settings", { p_admin_token_hash: await sha256(adminToken), p_payload: payload });
  status.textContent = error ? error.message : "Настройки сохранены";
  if (!error) settings = { ...settings, ...payload };
});

document.addEventListener("change", async (event) => {
  if (!event.target.matches("[data-registration-status]")) return;
  const { error } = await client.rpc("admin_update_registration_status", { p_admin_token_hash: await sha256(adminToken), p_registration_id: event.target.dataset.registrationStatus, p_status: event.target.value });
  status.textContent = error ? error.message : "Статус игрока обновлён";
  if (!error) await loadAdminData();
});

function initialTeams(players, count) {
  const sorted = [...players].sort((a, b) => b.mv_rating - a.mv_rating);
  const teams = Array.from({ length: count }, () => []);
  sorted.forEach((player, index) => {
    const round = Math.floor(index / count);
    const position = index % count;
    const teamIndex = round % 2 === 0 ? position : count - 1 - position;
    teams[teamIndex].push(player);
  });
  return teams;
}

const teamAverage = (team) => team.reduce((sum, player) => sum + player.mv_rating, 0) / Math.max(team.length, 1);
const objective = (teams) => {
  const averages = teams.map(teamAverage);
  const mean = averages.reduce((sum, value) => sum + value, 0) / averages.length;
  const variance = averages.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const rolePenalty = teams.reduce((sum, team) => sum + Math.max(0, team.filter((player) => player.primary_role === "awp").length - 1) * 8 + (team.some((player) => player.primary_role === "igl") ? 0 : 3), 0);
  return variance + rolePenalty;
};

function improveTeams(teams) {
  let best = teams.map((team) => [...team]);
  let bestScore = objective(best);
  for (let pass = 0; pass < 1500; pass += 1) {
    const a = Math.floor(Math.random() * best.length);
    let b = Math.floor(Math.random() * best.length);
    if (a === b || !best[a].length || !best[b].length) continue;
    const ai = Math.floor(Math.random() * best[a].length);
    const bi = Math.floor(Math.random() * best[b].length);
    const candidate = best.map((team) => [...team]);
    [candidate[a][ai], candidate[b][bi]] = [candidate[b][bi], candidate[a][ai]];
    const score = objective(candidate);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return { teams: best, score: bestScore };
}

document.getElementById("generateBalancedTeams").addEventListener("click", async () => {
  const eligible = registrations.filter((row) => row.status === "approved" && row.mv_rating != null);
  const count = Number(document.getElementById("registrationTeamCount").value);
  if (eligible.length < count * 2) {
    status.textContent = "Недостаточно подтверждённых игроков с рассчитанным рейтингом.";
    return;
  }
  const result = improveTeams(initialTeams(eligible, count));
  const rows = result.teams.flatMap((team, index) => team.map((player, position) => ({ registration_id: player.id, team_no: index + 1, slot_no: position + 1 })));
  const { error } = await client.rpc("admin_publish_balanced_teams", { p_admin_token_hash: await sha256(adminToken), p_objective_score: result.score, p_assignments: rows });
  status.textContent = error ? error.message : "Сбалансированные команды опубликованы";
  document.getElementById("generatedTeamsAdmin").innerHTML = result.teams.map((team, index) => `<article><strong>Команда ${index + 1} · ${teamAverage(team).toFixed(1)} MV</strong><span>${team.map((player) => escapeHtml(player.cs_nick)).join(" · ")}</span></article>`).join("");
});

if (adminToken) loadAdminData().catch((error) => {
  sessionStorage.removeItem("mvou-registration-admin-token");
  adminToken = "";
  document.getElementById("registrationAccessMessage").textContent = error.message;
});

