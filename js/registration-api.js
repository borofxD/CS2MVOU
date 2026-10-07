import { TOURNAMENT_ID } from "./config.js";
import { getClient } from "./supabase.js?v=20260913c";

const STORAGE_KEY = "mvou-player-registration";
export function getRegistrationClient() {
  return getClient();
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value) {
  const input = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
}

function makeToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function readRegistrationSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

export async function loadRegistrationSettings() {
  const { data, error } = await getRegistrationClient()
    .from("registration_settings")
    .select("*")
    .eq("tournament_id", TOURNAMENT_ID)
    .single();
  if (error) throw error;
  return data;
}

export async function loadOwnRegistration() {
  const session = readRegistrationSession();
  if (!session?.id || !session?.token) return null;
  const { data, error } = await getRegistrationClient().rpc("get_own_registration", {
    p_registration_id: session.id,
    p_edit_token_hash: await sha256(session.token)
  });
  if (error) {
    if (error.code === "P0001") localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return data;
}

export async function submitRegistration(payload) {
  let session = readRegistrationSession();
  if (!session?.token) session = { token: makeToken() };
  const { data, error } = await getRegistrationClient().rpc("submit_player_registration", {
    p_payload: { ...payload, tournament_id: TOURNAMENT_ID },
    p_edit_token_hash: await sha256(session.token),
    p_registration_id: session.id || null
  });
  if (error) throw error;
  session.id = data.id;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return data;
}

export function subscribePublicPlayers(onChange) {
  const supabase = getRegistrationClient();
  const channel = supabase
    .channel("public-players")
    .on("postgres_changes", { event: "*", schema: "public", table: "player_registrations" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "player_ratings" }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
