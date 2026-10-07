import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

const STEAM_ID_PATTERN = /7656119\d{10}/;
const VANITY_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

export function extractSteamId64(value) {
  return String(value || "").match(STEAM_ID_PATTERN)?.[0] || "";
}

export function parseSteamProfileInput(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("Укажи SteamID64 или ссылку на Steam-профиль");

  const steamId = extractSteamId64(input);
  if (steamId) return { kind: "steam_id", steamId };

  let vanity = input;
  if (input.includes("/") || input.includes("steamcommunity.com")) {
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input.replace(/^\/+/, "")}`;
    let url;
    try {
      url = new URL(candidate);
    } catch {
      throw new Error("Проверь ссылку на Steam-профиль");
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "steamcommunity.com") throw new Error("Нужна ссылка именно на steamcommunity.com");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() !== "id" || !parts[1]) {
      throw new Error("Поддерживается ссылка вида steamcommunity.com/id/твой_ник");
    }
    vanity = decodeURIComponent(parts[1]);
  }

  if (!VANITY_PATTERN.test(vanity)) throw new Error("Не удалось распознать буквенный Steam ID");
  return { kind: "vanity", vanity };
}

export async function resolveSteamId64(value, fetchImpl = globalThis.fetch) {
  const parsed = parseSteamProfileInput(value);
  if (parsed.kind === "steam_id") return parsed.steamId;

  const response = await fetchImpl(`${SUPABASE_URL}/functions/v1/resolve-steam-profile`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ profile: value })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось определить SteamID64");
  const steamId = extractSteamId64(data.steam_id);
  if (!steamId) throw new Error("Steam вернул некорректный SteamID64");
  return steamId;
}
