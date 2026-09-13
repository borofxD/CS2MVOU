import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.55.0/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, TEAM_LOGO_BUCKET, TOURNAMENT_ID } from "./config.js";
import { normalizeState } from "./data.js";

let client;

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase ещё не настроен: заполните js/config.js");
  }

  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }

  return client;
}

function parseRow(row) {
  if (!row) throw new Error("Строка турнира не найдена");
  return { state: normalizeState(row.state), revision: Number(row.revision || 0) };
}

export async function loadTournament() {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("state, revision")
    .eq("id", TOURNAMENT_ID)
    .single();

  if (error) throw error;
  return parseRow(data);
}

export function subscribeTournament(onChange, onStatus) {
  const supabase = getClient();
  let disposed = false;

  loadTournament()
    .then((snapshot) => {
      if (!disposed) onChange(snapshot);
    })
    .catch((error) => {
      if (!disposed) onStatus?.("error", error.message);
    });

  const channel = supabase
    .channel(`tournament-${TOURNAMENT_ID}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${TOURNAMENT_ID}` },
      (payload) => onChange(parseRow(payload.new))
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("online", "Синхронизировано");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus?.("error", "Ошибка синхронизации");
    });

  return () => {
    disposed = true;
    supabase.removeChannel(channel);
  };
}

export async function saveTournament(state, expectedRevision) {
  const supabase = getClient();
  const nextRevision = expectedRevision + 1;
  const { data, error } = await supabase
    .from("tournaments")
    .update({
      state,
      revision: nextRevision,
      updated_at: new Date().toISOString()
    })
    .eq("id", TOURNAMENT_ID)
    .eq("revision", expectedRevision)
    .select("state, revision")
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const conflict = new Error("Данные уже изменил другой пользователь. Загружена свежая версия.");
    conflict.code = "CONFLICT";
    throw conflict;
  }

  return parseRow(data);
}

async function imageToWebp(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Поддерживаются только PNG, JPG и WebP");
  }
  if (file.size > 5 * 1024 * 1024) throw new Error("Исходный файл должен быть меньше 5 МБ");

  const bitmap = await createImageBitmap(file);
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const ratio = Math.min(size / bitmap.width, size / bitmap.height);
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);
  context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  bitmap.close();

  const encode = (quality) => new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  let blob = await encode(0.9);
  if (blob?.size > 1024 * 1024) blob = await encode(0.72);
  if (!blob || blob.size > 1024 * 1024) throw new Error("Не удалось уменьшить логотип до 1 МБ");
  return blob;
}

export async function uploadTeamLogo(teamKey, file) {
  const supabase = getClient();
  const blob = await imageToWebp(file);
  const path = `teams/${teamKey}.webp`;
  const { error } = await supabase.storage
    .from(TEAM_LOGO_BUCKET)
    .upload(path, blob, { contentType: "image/webp", cacheControl: "3600", upsert: true });

  if (error) throw error;
  const { data } = supabase.storage.from(TEAM_LOGO_BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
