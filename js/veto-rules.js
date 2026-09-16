export const MAP_POOL = [
  { id: "ancient", name: "Ancient", code: "AN", tone: "moss" },
  { id: "anubis", name: "Anubis", code: "AB", tone: "sand" },
  { id: "cache", name: "Cache", code: "CA", tone: "toxic" },
  { id: "dust2", name: "Dust II", code: "D2", tone: "sun" },
  { id: "inferno", name: "Inferno", code: "IN", tone: "ember" },
  { id: "mirage", name: "Mirage", code: "MI", tone: "violet" },
  { id: "nuke", name: "Nuke", code: "NU", tone: "steel" }
];

export const VETO_PLANS = {
  1: [
    ["ban", "A"], ["ban", "A"], ["ban", "B"], ["ban", "B"],
    ["ban", "B"], ["ban", "A"], ["side", "B", 1]
  ],
  3: [
    ["ban", "A"], ["ban", "B"], ["pick", "A", 1], ["side", "B", 1],
    ["pick", "B", 2], ["side", "A", 2], ["ban", "B"], ["ban", "A"],
    ["side", "B", 3]
  ],
  5: [
    ["ban", "A"], ["ban", "B"], ["pick", "A", 1], ["side", "B", 1],
    ["pick", "B", 2], ["side", "A", 2], ["pick", "A", 3], ["side", "B", 3],
    ["pick", "B", 4], ["side", "A", 4], ["side", "B", 5]
  ]
};

export function getMap(id) {
  return MAP_POOL.find((map) => map.id === id) || { id, name: id || "Карта", code: "--", tone: "steel" };
}

export function getExpectedStep(state) {
  const raw = VETO_PLANS[Number(state?.format)]?.[state?.actions?.length || 0];
  if (!raw) return null;
  return { type: raw[0], role: raw[1], mapNo: raw[2] || null };
}

export function getExpectedActor(state) {
  const step = getExpectedStep(state);
  return step ? state?.roles?.[`team${step.role}`] : null;
}

export function getMapStatus(state, mapId) {
  const action = state?.actions?.find((item) => item.map === mapId);
  if (action) return action.type;
  if (state?.series?.some((item) => item.map === mapId)) return "decider";
  return "available";
}

export function describeStep(step) {
  if (!step) return "Veto завершён";
  if (step.type === "ban") return `Team ${step.role} банит карту`;
  if (step.type === "pick") return `Team ${step.role} выбирает карту №${step.mapNo}`;
  return `Team ${step.role} выбирает стартовую сторону на карте №${step.mapNo}`;
}
