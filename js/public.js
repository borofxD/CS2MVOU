import { createInitialState } from "./data.js?v=20260913c";
import { renderPublic } from "./render.js?v=20260913c";
import { subscribeTournament } from "./supabase.js";

const status = document.getElementById("connectionStatus");
const toast = document.getElementById("toast");

function setStatus(type, message) {
  status.dataset.status = type;
  status.lastChild.textContent = message;
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 4200);
}

renderPublic(createInitialState());

try {
  subscribeTournament(
    ({ state }) => renderPublic(state),
    (type, message) => {
      setStatus(type, message);
      if (type === "error") showToast(message, "error");
    }
  );
} catch (error) {
  setStatus("error", "Нет подключения");
  showToast(error.message, "error");
}
