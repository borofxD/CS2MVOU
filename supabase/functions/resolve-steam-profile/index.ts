const PUBLISHABLE_KEY = "sb_publishable_3rkI2Xm9uWqFDdPTjkArEA_tfFIhwMb";
const ALLOWED_ORIGINS = new Set([
  "https://borofxd.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
]);
const VANITY_PATTERN = /^[a-zA-Z0-9_-]{2,64}$/;

function response(req: Request, body: Record<string, unknown>, status = 200) {
  const origin = req.headers.get("origin") || "";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://borofxd.github.io",
      "Access-Control-Allow-Headers": "apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin"
    }
  });
}

function parseProfile(value: unknown) {
  const input = String(value || "").trim();
  const direct = input.match(/7656119\d{10}/)?.[0];
  if (direct) return { steamId: direct, vanity: "" };

  let vanity = input;
  if (input.includes("/") || input.includes("steamcommunity.com")) {
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input.replace(/^\/+/, "")}`;
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "steamcommunity.com") throw new Error("Нужна ссылка именно на steamcommunity.com");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() !== "id" || !parts[1]) throw new Error("Проверь ссылку на Steam-профиль");
    vanity = decodeURIComponent(parts[1]);
  }
  if (!VANITY_PATTERN.test(vanity)) throw new Error("Не удалось распознать буквенный Steam ID");
  return { steamId: "", vanity };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return response(req, { ok: true });
  if (req.method !== "POST") return response(req, { error: "Метод не поддерживается" }, 405);
  if (!ALLOWED_ORIGINS.has(origin) || req.headers.get("apikey") !== PUBLISHABLE_KEY) {
    return response(req, { error: "Запрос отклонён" }, 403);
  }

  try {
    const length = Number(req.headers.get("content-length") || 0);
    if (length > 1024) return response(req, { error: "Слишком длинный запрос" }, 413);
    const payload = await req.json();
    const parsed = parseProfile(payload?.profile);
    if (parsed.steamId) return response(req, { steam_id: parsed.steamId });

    const steamUrl = `https://steamcommunity.com/id/${encodeURIComponent(parsed.vanity)}/?xml=1`;
    const upstream = await fetch(steamUrl, {
      headers: { "Accept": "application/xml,text/xml;q=0.9", "User-Agent": "CS2MVOU/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) return response(req, { error: "Steam-профиль не найден" }, 404);
    const xml = (await upstream.text()).slice(0, 524288);
    const steamId = xml.match(/<steamID64>(\d{17})<\/steamID64>/)?.[1];
    if (!steamId) return response(req, { error: "Steam не вернул SteamID64. Проверь ссылку и доступность профиля." }, 404);
    return response(req, { steam_id: steamId });
  } catch (error) {
    const message = error instanceof Error && !error.message.includes("URL")
      ? error.message
      : "Не удалось определить SteamID64";
    return response(req, { error: message }, 400);
  }
});
