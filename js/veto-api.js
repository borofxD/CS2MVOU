import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.55.0/+esm";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";

let client;

function getClient() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return client;
}

function unwrap(data, error) {
  if (error) throw error;
  return data;
}

export async function createVetoRoom(team1Name, team2Name) {
  const { data, error } = await getClient().rpc("create_veto_room", {
    p_team1_name: team1Name,
    p_team2_name: team2Name
  });
  return unwrap(data, error);
}

export async function loadVetoRoom(roomId, token) {
  const { data, error } = await getClient().rpc("get_veto_room", {
    p_room_id: roomId,
    p_token: token
  });
  return unwrap(data, error);
}

export async function sendVetoAction(roomId, token, revision, action) {
  const { data, error } = await getClient().rpc("veto_room_action", {
    p_room_id: roomId,
    p_token: token,
    p_expected_revision: revision,
    p_action: action
  });
  return unwrap(data, error);
}

export function getRoomAccess() {
  const url = new URL(window.location.href);
  const roomId = url.searchParams.get("room") || "";
  const suppliedToken = url.searchParams.get("token") || "";
  const storageKey = roomId ? `veto-token:${roomId}` : "";
  if (roomId && suppliedToken) sessionStorage.setItem(storageKey, suppliedToken);
  const token = suppliedToken || (storageKey ? sessionStorage.getItem(storageKey) : "") || "";

  if (suppliedToken) {
    url.searchParams.delete("token");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return { roomId, token };
}

export function subscribeVetoRoom(roomId, onSignal, onStatus) {
  const supabase = getClient();
  const channel = supabase
    .channel(`veto-room-${roomId}`)
    .on("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "veto_room_events",
      filter: `room_id=eq.${roomId}`
    }, (payload) => onSignal(Number(payload.new?.revision || 0)))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("online", "Синхронизировано");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus?.("error", "Realtime недоступен");
    });

  return () => supabase.removeChannel(channel);
}
