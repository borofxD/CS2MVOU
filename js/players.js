import { getRegistrationClient, loadRegistrationSettings, subscribePublicPlayers } from "./registration-api.js";

const list = document.getElementById("playersList");
const search = document.getElementById("playerSearch");
const sort = document.getElementById("playerSort");
let players = [];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function confidenceLabel(value) {
  if (value >= 75) return "Высокая";
  if (value >= 45) return "Средняя";
  return "Низкая";
}

function renderPlayers() {
  const query = search.value.trim().toLowerCase();
  const visible = players.filter((player) => player.cs_nick.toLowerCase().includes(query));
  visible.sort((a, b) => {
    if (sort.value === "name") return a.cs_nick.localeCompare(b.cs_nick, "ru");
    if (sort.value === "newest") return new Date(b.submitted_at) - new Date(a.submitted_at);
    return (b.mv_rating ?? -1) - (a.mv_rating ?? -1);
  });
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state">Пока нет подтверждённых игроков.</div>';
    return;
  }
  list.innerHTML = visible.map((player, index) => {
    const rating = player.mv_rating == null ? "—" : Math.round(player.mv_rating);
    return `<article class="player-row">
      <span class="player-rank">${String(index + 1).padStart(2, "0")}</span>
      <div class="player-identity"><span class="country-code">${escapeHtml(player.country_code)}</span><div><strong>${escapeHtml(player.cs_nick)}</strong><small>${escapeHtml(player.primary_role || "flex")} · ${player.faceit_level ? `FACEIT ${player.faceit_level}` : "без FACEIT"}${player.premier_rating ? ` · ${Number(player.premier_rating).toLocaleString("ru-RU")} Premier` : ""}</small></div></div>
      <div class="rating-breakdown"><span><small>Уровень</small><b>${player.baseline_score == null ? "—" : Math.round(player.baseline_score)}</b></span><span><small>Форма</small><b>${player.performance_score == null ? "—" : Math.round(player.performance_score)}</b></span><span><small>Данные</small><b>${player.confidence == null ? "Ожидание" : confidenceLabel(player.confidence)}</b></span></div>
      <div class="mv-score ${rating === "—" ? "is-pending" : ""}"><small>MV</small><strong>${rating}</strong></div>
      <div class="player-links"><a href="${escapeHtml(player.csstats_url)}" target="_blank" rel="noopener">CSStats</a><a href="${escapeHtml(player.csrep_url)}" target="_blank" rel="noopener">CSRep</a></div>
    </article>`;
  }).join("");
}

async function loadPlayers() {
  const client = getRegistrationClient();
  const [{ data, error }, settings] = await Promise.all([
    client.rpc("get_public_players"),
    loadRegistrationSettings()
  ]);
  if (error) throw error;
  players = data || [];
  document.getElementById("playersCount").textContent = players.length;
  const rated = players.filter((player) => player.mv_rating != null);
  document.getElementById("playersAverage").textContent = rated.length ? Math.round(rated.reduce((sum, player) => sum + player.mv_rating, 0) / rated.length) : "—";
  const remaining = new Date(settings.closes_at).getTime() - Date.now();
  document.getElementById("playersDeadline").textContent = remaining > 0 ? `${Math.ceil(remaining / 86400000)} дн.` : "закрыта";
  document.getElementById("playersState").textContent = settings.ratings_published ? "Рейтинг опубликован" : (remaining > 0 ? "Регистрация открыта" : "Расчёт рейтинга");
  renderPlayers();

  const { data: teams, error: teamError } = await client.rpc("get_published_teams");
  if (teamError || !teams?.length) return;
  const grouped = Map.groupBy ? Map.groupBy(teams, (row) => row.team_no) : teams.reduce((map, row) => map.set(row.team_no, [...(map.get(row.team_no) || []), row]), new Map());
  document.getElementById("balancedTeamsSection").hidden = false;
  document.getElementById("balanceScore").textContent = `Разброс средних: ${Math.max(...teams.map((row) => row.team_average)) - Math.min(...teams.map((row) => row.team_average)) < 1 ? "< 1" : "минимальный"}`;
  document.getElementById("generatedTeams").innerHTML = [...grouped].map(([teamNo, members]) => `<article class="generated-team"><header><span>Команда ${teamNo}</span><strong>${Number(members[0].team_average).toFixed(1)} MV</strong></header>${members.map((member) => `<div><span>${escapeHtml(member.cs_nick)}</span><b>${Math.round(member.mv_rating)}</b></div>`).join("")}</article>`).join("");
}

search.addEventListener("input", renderPlayers);
sort.addEventListener("change", renderPlayers);
subscribePublicPlayers(() => loadPlayers().catch(() => {}));
loadPlayers().catch((error) => { list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; });
