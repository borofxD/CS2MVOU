import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
const asNumber = (value) => {
  if (value == null || value === "" || value === "---") return null;
  const normalized = String(value).trim().replace(/\s/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  const number = Number(normalized.replace(/%$/, ""));
  return Number.isFinite(number) ? number : null;
};

function capture(text, pattern) {
  return asNumber(text.match(pattern)?.[1]);
}

export function parseCsStats(text) {
  const clean = text.replace(/\u00a0/g, " ").replace(/\r/g, "");
  const seasons = [...clean.matchAll(/S\d\s+20\d{2}\s+(\d+)\s+([\d,]+|---)\s+([\d,]+|---)/g)]
    .map((match) => ({ wins: asNumber(match[1]), current: asNumber(match[2]), peak: asNumber(match[3]) }))
    .filter((season) => season.current != null || season.peak != null);
  return {
    kd: capture(clean, /K\/D\s+([\d.,]+)/i),
    hltv: capture(clean, /HLTV RATING\s+([\d.,]+)/i),
    win_rate: capture(clean, /WIN RATE\s+([\d.,]+)%/i),
    matches: capture(clean, /PLAYED\s+(\d+)/i),
    hs: capture(clean, /HS%\s+([\d.,]+)%/i),
    adr: capture(clean, /ADR\s+([\d.,]+)/i),
    kast: capture(clean, /KAST\s+([\d.,]+)%/i),
    kills: capture(clean, /KILLS\s+(\d+)/i),
    deaths: capture(clean, /DEATHS\s+(\d+)/i),
    premier_current: seasons[0]?.current ?? null,
    premier_peak: seasons[0]?.peak ?? null
  };
}

export function parseCsRep(text) {
  const clean = text.replace(/\u00a0/g, " ").replace(/\r/g, "");
  return {
    trust_score: capture(clean, /Trust Score\s+([\d.,]+)\s*%/i),
    matches: capture(clean, /Stats Overview\s+Last\s+(\d+)\s+Matches/i),
    time_to_damage: capture(clean, /Time to Damage\s+([\d.,]+)\s*ms/i),
    reaction_time: capture(clean, /Reaction Time\s+([\d.,]+)\s*ms/i),
    crosshair_placement: capture(clean, /Crosshair Placement\s+([\d.,]+)\s*°/i),
    preaim: capture(clean, /Preaim\s+([\d.,]+)\s*°/i),
    kd: capture(clean, /K\/D Ratio\s+([\d.,]+)/i),
    adr: capture(clean, /ADR\s+([\d.,]+)/i),
    aim_accuracy: capture(clean, /Aim Accuracy\s+([\d.,]+)\s*%/i),
    head_accuracy: capture(clean, /Head Accuracy\s+([\d.,]+)\s*%/i),
    hltv: capture(clean, /HLTV Rating 2\.0\s+([\d.,]+)/i),
    kast: capture(clean, /KAST\s+([\d.,]+)\s*%/i)
  };
}

function faceitEloFromLevel(level) {
  return ({ 1: 300, 2: 650, 3: 850, 4: 1050, 5: 1200, 6: 1350, 7: 1500, 8: 1650, 9: 1850, 10: 2050 })[level] ?? null;
}

function faceitScore(elo) {
  if (elo == null) return null;
  return clamp(100 / (1 + Math.exp(-(elo - 1750) / 620)));
}

function premierScore(rating) {
  if (rating == null) return null;
  return clamp(100 / (1 + Math.exp(-(rating - 15500) / 5200)));
}

function blendMetric(csstats, csrep, key) {
  const longTerm = csstats[key];
  const recent = csrep[key];
  if (longTerm != null && recent != null) return longTerm * 0.6 + recent * 0.4;
  return recent ?? longTerm ?? null;
}

export function calculateMvRating(registration, csstats = {}, csrep = {}) {
  const exactFaceit = registration.faceit_elo ?? faceitEloFromLevel(registration.faceit_level);
  const declaredPremier = Number(registration.premier_rating) > 0 ? Number(registration.premier_rating) : null;
  const detectedPremier = declaredPremier ?? csstats.premier_current;
  const faceit = faceitScore(exactFaceit);
  const premier = premierScore(detectedPremier);
  let baseline = 50;
  if (faceit != null && premier != null) baseline = faceit * 0.72 + premier * 0.28;
  else if (faceit != null) baseline = faceit;
  else if (premier != null) baseline = premier;

  const kd = blendMetric(csstats, csrep, "kd");
  const hltv = blendMetric(csstats, csrep, "hltv");
  const adr = blendMetric(csstats, csrep, "adr");
  const kast = blendMetric(csstats, csrep, "kast");
  const observed = clamp(50 + ((hltv ?? 1) - 1) * 40 + ((kd ?? 1) - 1) * 15 + ((adr ?? 75) - 75) * 0.3 + ((kast ?? 70) - 70) * 0.5);
  const matchCount = Math.max(csrep.matches ?? 0, Math.min(csstats.matches ?? 0, 30));
  const reliability = clamp(matchCount / 20, 0, 1);
  const performance = 50 + reliability * (observed - 50);
  const sources = Number(Object.values(csstats).some((value) => value != null)) + Number(Object.values(csrep).some((value) => value != null));
  const rankSignal = exactFaceit != null || detectedPremier != null ? 10 : 0;
  const confidence = clamp(sources * 20 + reliability * 50 + rankSignal);
  const mv = clamp(baseline * 0.62 + performance * 0.30 + confidence * 0.08);

  return {
    model_version: "mv-1.1",
    mv_rating: Number(mv.toFixed(2)),
    baseline_score: Number(baseline.toFixed(2)),
    performance_score: Number(performance.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    explanation: { faceit_elo: exactFaceit, premier_rating: detectedPremier, kd, hltv, adr, kast, matches: matchCount, sources, source_weights: { csstats: 0.6, csrep: 0.4 } },
    calculated_at: new Date().toISOString()
  };
}

export async function scrapePage(page, url, source, options = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(options.maxAttempts ?? process.env.SCRAPE_ATTEMPTS) || 3));
  const readyTimeout = Math.max(1000, Number(options.readyTimeout ?? process.env.STAT_READY_TIMEOUT_MS) || 120000);
  const navigationTimeout = Math.max(1000, Number(options.navigationTimeout) || 60000);
  const retryDelay = Math.max(0, Number(options.retryDelay) || 5000);
  let navigated = false;
  let lastError = "Не удалось получить статистику";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (navigated) await page.reload({ waitUntil: "domcontentloaded", timeout: navigationTimeout });
      else {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
        navigated = true;
      }
      await page.waitForFunction((currentSource) => {
        const text = document.body?.innerText || "";
        return currentSource === "csstats"
          ? /HLTV RATING\s+[\d.,]+/i.test(text)
          : /HLTV RATING 2\.0\s+[\d.,]+/i.test(text);
      }, source, { timeout: readyTimeout });
      const text = await page.locator("body").innerText({ timeout: 15000 });
      const metrics = source === "csstats" ? parseCsStats(text) : parseCsRep(text);
      const useful = Object.values(metrics).filter((value) => value != null).length;
      if (useful < 3) throw new Error(`Получено только ${useful} публичных показателя`);
      return { source, source_url: url, metrics, fetch_status: "ready", error: null, fetched_at: new Date().toISOString() };
    } catch (error) {
      lastError = `Попытка ${attempt}/${maxAttempts}: ${String(error.message)}`;
      if (attempt < maxAttempts) await page.waitForTimeout(retryDelay);
    }
  }

  return { source, source_url: url, metrics: {}, fetch_status: "failed", error: lastError.slice(0, 500), fetched_at: new Date().toISOString() };
}

async function processRegistration(registration, supabase, context, collectorTokenHash) {
  const { error: processingError } = await supabase.rpc("collector_set_processing", { p_collector_token_hash: collectorTokenHash, p_registration_id: registration.id });
  if (processingError) throw processingError;
  const [csstatsPage, csrepPage] = await Promise.all([context.newPage(), context.newPage()]);
  let csstats;
  let csrep;
  try {
    [csstats, csrep] = await Promise.all([
      scrapePage(csstatsPage, registration.csstats_url, "csstats"),
      scrapePage(csrepPage, registration.csrep_url, "csrep")
    ]);
  } finally {
    await Promise.all([csstatsPage.close(), csrepPage.close()]);
  }
  const snapshots = [csstats, csrep];
  const ready = snapshots.filter((snapshot) => snapshot.fetch_status === "ready");
  const hasDeclaredLevel = registration.faceit_level != null || registration.faceit_elo != null || registration.premier_rating != null;
  const rating = ready.length || hasDeclaredLevel ? calculateMvRating(registration, csstats.metrics, csrep.metrics) : null;
  const scrapeStatus = ready.length === 2 ? "ready" : ready.length === 1 ? "partial" : "failed";
  const scrapeError = snapshots.filter((snapshot) => snapshot.error).map((snapshot) => `${snapshot.source}: ${snapshot.error}`).join(" | ") || null;
  const { error: storeError } = await supabase.rpc("collector_store_results", {
    p_collector_token_hash: collectorTokenHash,
    p_registration_id: registration.id,
    p_snapshots: snapshots,
    p_rating: rating,
    p_scrape_status: scrapeStatus,
    p_scrape_error: scrapeError
  });
  if (storeError) throw storeError;
  console.log(`${registration.cs_nick}: ${scrapeStatus}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  const collectorToken = process.env.STATS_COLLECTOR_TOKEN;
  if (!url || !publishableKey || !collectorToken) throw new Error("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY и STATS_COLLECTOR_TOKEN обязательны");
  const collectorTokenHash = createHash("sha256").update(collectorToken).digest("hex");
  const supabase = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("collector_get_queue", { p_collector_token_hash: collectorTokenHash });
  if (error) throw error;
  const queue = data || [];
  if (!queue.length) { console.log("Нет анкет для обновления"); return; }

  const browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== "false" });
  try {
    const context = await browser.newContext({ locale: "en-US", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36" });
    const concurrency = Math.max(1, Math.min(3, Number(process.env.REGISTRATION_CONCURRENCY) || 2));
    let nextIndex = 0;
    const failures = [];
    const worker = async () => {
      while (nextIndex < queue.length) {
        const registration = queue[nextIndex];
        nextIndex += 1;
        try {
          await processRegistration(registration, supabase, context, collectorTokenHash);
        } catch (error) {
          const message = `${registration.cs_nick}: ${String(error.message || error)}`;
          failures.push(message);
          console.error(message);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    if (failures.length) throw new Error(`Ошибки обработки: ${failures.join(" | ")}`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
