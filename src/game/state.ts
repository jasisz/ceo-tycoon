// Rule-based simulation core (with a few dice rolls: audits, who gets laid off).
// The LLM only proposes deltas; this module applies and clamps them, runs the quarterly
// economy, company systems, people's memories and grudges, investor KPIs and win/lose.

import {
  FLOOR_COST,
  FLOOR_DESKS,
  FLOOR_RENT,
  HOT_DESK_OVERFLOW,
  MAX_HEADCOUNT,
  OFFICES,
  upgradeById,
  type OfficeTier,
} from "./office";

export const FIRE_TARGET = 5_000_000;
export const ACTIONS_PER_QUARTER = 2;
export const IPO_VALUATION = 45_000_000;

const REVENUE_PER_EMPLOYEE = 38_000;
const CONTRACTOR_RATE = 3;
const KEY_PERSON_PREMIUM = 20_000;
const CEO_PAY = 90_000;
const LICENSE_COST = 1_500;

export interface Employee {
  id: number;
  name: string;
  role: string;
  quirk: string;
  moodOffset: number;
  desk: number; // -1 = hot-desking (no desk)
  talkedQuarter: number;
  salary: number; // per quarter
  history: string[]; // what this person remembers about the CEO (fed to the LLM)
  knowsZug?: boolean; // saw the "consulting" invoices
  contractor?: boolean; // rehired at CONTRACTOR_RATE x salary
}

// ---------- company systems ----------

export type SystemId = "infra" | "billing" | "product" | "sales";

export const SYSTEMS: Record<SystemId, { name: string; emoji: string; roles: string[]; crisis: string }> = {
  infra: { name: "Infra", emoji: "🖥️", roles: ["DevOps", "Backend Dev"], crisis: "Production is down. The status page is also down." },
  billing: { name: "Billing", emoji: "🧾", roles: ["Backend Dev", "Data Scientist", "Office Manager"], crisis: "Billing invoiced every customer $0.00, then $1M." },
  product: { name: "Product", emoji: "🎨", roles: ["Frontend Dev", "Designer", "Product Manager", "QA Engineer"], crisis: "The latest release removed the Save button. Nobody noticed for a week." },
  sales: { name: "Sales", emoji: "📞", roles: ["Sales Rep", "Growth Hacker"], crisis: "The sales pipeline is empty. The CRM has one deal, named 'test'." },
};
export const SYSTEM_IDS = Object.keys(SYSTEMS) as SystemId[];

export interface SystemState {
  health: number; // 0..100
  owner: number | null; // employee id; null = nobody understands it
}

export interface Alumnus {
  id: number;
  name: string;
  role: string;
  quirk: string;
  salary: number;
  history: string[];
  knowsZug?: boolean;
  owned: SystemId[]; // systems only they understood
  leftQuarter: number;
  reason: "laid off" | "fired" | "quit";
  grudge: number; // 0..100
  atCompetitor?: boolean;
  reviewed?: boolean; // posted the Glassdoor review
  blewWhistle?: boolean;
  refusedQuarter?: number;
}

export type KpiMetric = "revenue" | "headcount" | "valuation" | "hype";

export interface Kpi {
  quote: string; // what the CEO actually said
  metric: KpiMetric;
  baseline: number;
  target: number;
  dueQuarter: number;

}

export interface PromiseItem {
  text: string;
  dueQuarter: number;
  cost: number;
}

export interface Effects {
  morale?: number;
  hype?: number;
  suspicion?: number;
  cash?: number;
  offshore?: number;
  headcount?: number;
}

export interface GameState {
  company: string;
  product: string;
  career: number; // how many companies you've run
  quarter: number;
  cash: number;
  morale: number;
  hype: number;
  suspicion: number;
  reputation: number;
  savings: number;
  offshore: number;
  equity: number; // CEO's share of the company, 0..1
  office: OfficeTier;
  floors: number; // extra leased floors (open space only)
  upgrades: string[];
  employees: Employee[];
  promises: PromiseItem[];
  systems: Record<SystemId, SystemState>;
  crises: SystemId[];
  alumni: Alumnus[];
  kpis: Kpi[];
  boardDemands: string[]; // reasons the board wants to see you next quarter
  actionsLeft: number;
  lastPartyQuarter: number;
  lastRaiseQuarter: number;
  lastRevenue: number;
  eventResolvedQuarter: number; // quarter whose random event has been played
  recentEvents: string[];
  log: string[];
  over?: { win: boolean; title: string; text: string; canContinue: boolean };
}

const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Kai", "Robin", "Skyler", "Charlie", "Dana", "Emery", "Frankie", "Harper", "Jesse"];
const LAST = ["Kowalski", "Nguyen", "Smith", "Garcia", "Müller", "Rossi", "Okafor", "Novak", "Silva", "Kim", "Patel", "Dubois", "Larsen", "Cohen"];
const ROLES = ["Frontend Dev", "Backend Dev", "Product Manager", "QA Engineer", "Designer", "Data Scientist", "Sales Rep", "HR Partner", "DevOps", "Scrum Master", "Growth Hacker", "Office Manager"];
const QUIRKS = [
  "has been waiting for a raise for three years",
  "writes Rust after hours and mentions it constantly",
  "has four monitors and uses one",
  "asks about English lessons reimbursement every week",
  "is secretly interviewing at a competitor",
  "keeps a spreadsheet of every promise the CEO made",
  "thinks every problem can be solved with Kubernetes",
  "has never once turned the camera on",
  "is the only one who understands the billing system",
  "brings their dog to every meeting, including remote ones",
  "believes this is a family",
  "posts motivational quotes on LinkedIn at 5am",
];
const PREFIX = ["Synergy", "Cloud", "Hyper", "Quantum", "Agile", "Pixel", "Data", "Nimbus", "Vertex", "Blue"];
const SUFFIX = ["Flow", "Hub", "ly", "Forge", "Stack", "ify", "Labs", "io", "Base", "Mind"];
export const PRODUCTS = [
  "invoicing SaaS for dentists",
  "kebab ordering app",
  "B2B platform for everything",
  "CRM for alpaca farmers",
  "Uber for houseplants",
  "blockchain-based timesheets",
  "AI meeting summariser nobody reads",
  "LinkedIn for cats",
  "agentic AI for parking tickets",
];

const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
let nextId = 1;

// ---------- save / load ----------

const SAVE_KEY = "ceo-tycoon-save-v1";

export function saveGame(s: GameState) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota - the game still works, it just won't persist */
  }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GameState;
    if (!Array.isArray(s.employees) || typeof s.quarter !== "number" || typeof s.cash !== "number") return null;
    s.eventResolvedQuarter ??= s.quarter - 1;
    s.promises ??= [];
    s.recentEvents ??= [];
    s.log ??= [];
    s.office ??= "openspace";
    s.floors ??= 0;
    s.upgrades ??= [];
    for (const e of s.employees) {
      e.salary ??= 45_000;
      e.history ??= [];
    }
    s.alumni ??= [];
    s.kpis ??= [];
    s.boardDemands ??= [];
    s.crises ??= [];
    if (!s.systems) {
      s.systems = freshSystems();
      assignOwners(s);
    }
    nextId = Math.max(0, ...s.employees.map((e) => e.id)) + 1;
    return s;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

function makeEmployee(desk: number, quarter: number): Employee {
  return {
    id: nextId++,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    role: pick(ROLES),
    quirk: pick(QUIRKS),
    moodOffset: Math.round(Math.random() * 30 - 15),
    desk,
    talkedQuarter: quarter - 1,
    salary: 38_000 + Math.round(Math.random() * 14) * 1_000,
    history: [],
  };
}

const freshSystems = (): Record<SystemId, SystemState> => ({
  infra: { health: 80, owner: null },
  billing: { health: 80, owner: null },
  product: { health: 80, owner: null },
  sales: { health: 80, owner: null },
});

export const ownedBy = (s: GameState, id: number) => SYSTEM_IDS.filter((k) => s.systems[k].owner === id);

/** Make someone the only person who understands a system (and pay them like it). */
function makeOwner(s: GameState, sys: SystemId, e: Employee) {
  s.systems[sys].owner = e.id;
  if (ownedBy(s, e.id).length === 1) e.salary += KEY_PERSON_PREMIUM;
  e.quirk = `is the only one who understands ${SYSTEMS[sys].name.toLowerCase()}`;
  remember(e, s.quarter, `Became the only person who understands ${SYSTEMS[sys].name.toLowerCase()}.`);
}

/** Give every orphaned system an owner, preferring matching roles and people who own nothing yet. */
function assignOwners(s: GameState) {
  for (const sys of SYSTEM_IDS) {
    if (s.systems[sys].owner !== null || !s.employees.length) continue;
    const free = s.employees.filter((e) => !ownedBy(s, e.id).length);
    const pool = free.length ? free : s.employees;
    const match = pool.filter((e) => SYSTEMS[sys].roles.includes(e.role));
    makeOwner(s, sys, pick(match.length ? match : pool));
  }
}

/** Add a line to someone's memory of the CEO. */
export function remember(e: { history: string[] }, quarter: number, text: string) {
  e.history.push(`Q${quarter}: ${text}`);
  if (e.history.length > 8) e.history.splice(0, e.history.length - 8);
}

export function rememberAll(s: GameState, text: string) {
  for (const e of s.employees) remember(e, s.quarter, text);
}

/** Where your next CEO gig starts depends on how the last one went. */
function startingOffice(prev?: GameState): { office: OfficeTier; staff: number; cash: number } {
  if (!prev) return { office: "openspace", staff: 10, cash: 3_000_000 };
  if (prev.reputation >= 70) return { office: "openspace", staff: 10, cash: 3_500_000 };
  if (prev.reputation >= 45) return { office: "cowork", staff: 6, cash: 1_800_000 };
  return { office: "garage", staff: 3, cash: 700_000 };
}

export function newCompany(prev?: GameState): GameState {
  const start = startingOffice(prev);
  const s: GameState = {
    company: `${pick(PREFIX)}${pick(SUFFIX)} Inc.`,
    product: pick(PRODUCTS),
    career: (prev?.career ?? 0) + 1,
    quarter: 1,
    cash: start.cash,
    morale: 60,
    hype: 50,
    suspicion: prev ? Math.round(prev.suspicion / 3) : 0,
    reputation: prev?.reputation ?? 60,
    savings: prev?.savings ?? 200_000,
    offshore: prev?.offshore ?? 0,
    equity: start.office === "garage" ? 0.3 : start.office === "cowork" ? 0.18 : 0.1,
    office: start.office,
    floors: 0,
    upgrades: [],
    employees: [],
    promises: [],
    systems: freshSystems(),
    crises: [],
    alumni: [],
    kpis: [],
    boardDemands: [],
    actionsLeft: ACTIONS_PER_QUARTER,
    lastPartyQuarter: -10,
    lastRaiseQuarter: -10,
    lastRevenue: 0,
    eventResolvedQuarter: 0,
    recentEvents: [],
    log: [],
  };
  for (let i = 0; i < start.staff; i++) s.employees.push(makeEmployee(i, 1));
  assignOwners(s);
  log(
    s,
    prev
      ? `You land a new CEO gig at ${s.company} (${OFFICES[s.office].name.toLowerCase()}). Nobody checked your references.`
      : `Welcome, CEO of ${s.company} You make a ${s.product}.`,
  );
  return s;
}

export function log(s: GameState, msg: string) {
  s.log.unshift(`Q${s.quarter}: ${msg}`);
  s.log.length = Math.min(s.log.length, 60);
}

export const fmt = (n: number) => {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}k`;
  return `${sign}$${Math.round(a)}`;
};

export const netWorth = (s: GameState) => s.savings + s.offshore;

// ---------- office ----------

export const office = (s: GameState) => OFFICES[s.office];

export function capacity(s: GameState) {
  return office(s).desks + (s.office === "openspace" ? s.floors * FLOOR_DESKS : 0);
}

export function maxHeadcount(s: GameState) {
  return Math.min(MAX_HEADCOUNT, capacity(s) + HOT_DESK_OVERFLOW);
}

export function rent(s: GameState) {
  return office(s).rent + (s.office === "openspace" ? s.floors * FLOOR_RENT : 0);
}

export const hotDeskers = (s: GameState) => s.employees.filter((e) => e.desk < 0).length;

/** Give free desks to hot-deskers; evict people from desks that no longer exist. */
export function compactDesks(s: GameState) {
  const cap = capacity(s);
  for (const e of s.employees) if (e.desk >= cap) e.desk = -1;
  if (cap === Infinity) {
    s.employees.forEach((e, i) => (e.desk = i));
    return;
  }
  const used = new Set(s.employees.map((e) => e.desk));
  let d = 0;
  for (const e of s.employees.filter((x) => x.desk < 0)) {
    while (d < cap && used.has(d)) d++;
    if (d >= cap) break;
    e.desk = d;
    used.add(d);
  }
}

const ownedUpgrades = (s: GameState) => s.upgrades.flatMap((id) => upgradeById(id) ?? []);

export function upgradeCost(s: GameState, id: string) {
  const u = upgradeById(id)!;
  return u.perHead ? u.cost * Math.max(1, s.employees.length) : u.cost;
}

/** Why an upgrade can't be bought right now, or null if it can. */
export function upgradeBlocker(s: GameState, id: string): string | null {
  const u = upgradeById(id);
  if (!u) return "Unknown";
  if (s.upgrades.includes(id)) return "Owned";
  if (s.office === "remote" && u.remote === "no") return "Needs an office";
  if (s.office !== "remote" && u.remote === "only") return "Remote only";
  if (s.upgrades.length >= office(s).upgradeSlots) return "No space left";
  if (s.cash < upgradeCost(s, id)) return "Can't afford";
  return null;
}

export function buyUpgrade(s: GameState, id: string) {
  const u = upgradeById(id)!;
  const cost = upgradeCost(s, id);
  s.cash -= cost;
  s.upgrades.push(id);
  log(s, `Bought ${u.emoji} ${u.name} for ${fmt(cost)}. ${u.blurb}`);
}

export function moveBlocker(s: GameState, tier: OfficeTier): string | null {
  const o = OFFICES[tier];
  if (tier === s.office) return "You're here";
  if (valuation(s) < o.minValuation) return `Landlord wants a ${fmt(o.minValuation)} valuation`;
  if (s.cash < o.moveCost) return "Can't afford the move";
  if (s.employees.length > o.desks + HOT_DESK_OVERFLOW) return "Too many people to cram in";
  return null;
}

export function moveOffice(s: GameState, tier: OfficeTier) {
  const from = office(s);
  const to = OFFICES[tier];
  s.cash -= to.moveCost;
  const lost = s.upgrades.filter((id) => {
    const u = upgradeById(id)!;
    return tier === "remote" ? u.remote === "no" : u.remote === "only";
  });
  s.upgrades = s.upgrades.filter((id) => !lost.includes(id)).slice(0, to.upgradeSlots);
  s.office = tier;
  s.floors = 0;
  for (const e of s.employees) e.desk = -1;
  compactDesks(s);
  if (tier === "remote") {
    s.morale = clamp(s.morale + 6);
    s.hype = clamp(s.hype - 4);
    log(s, `Went remote-first. The office is now a Notion page. ${lost.length ? `Left behind: ${lost.map((id) => upgradeById(id)!.emoji).join(" ")}.` : ""}`);
  } else if (to.rank > from.rank) {
    s.hype = clamp(s.hype + 6 + to.rank * 2);
    s.morale = clamp(s.morale + 4);
    log(s, `Moved into a ${to.name.toLowerCase()} ${to.emoji}. LinkedIn post: "New chapter, same mission."`);
  } else {
    s.hype = clamp(s.hype - 8);
    s.morale = clamp(s.morale - 6);
    log(s, `Downsized to a ${to.name.toLowerCase()} ${to.emoji}. Officially "optimising our footprint".`);
  }
}

export function floorBlocker(s: GameState): string | null {
  if (s.office !== "openspace") return "Open-space offices only";
  if (s.floors >= 1) return "No more floors available";
  if (s.cash < FLOOR_COST) return "Can't afford the fit-out";
  return null;
}

export function leaseFloor(s: GameState) {
  s.cash -= FLOOR_COST;
  s.floors++;
  s.hype = clamp(s.hype + 5);
  compactDesks(s);
  log(s, `Leased the east wing (+${FLOOR_DESKS} desks). Facilities ordered ${FLOOR_DESKS} identical succulents.`);
}

// ---------- economy ----------

/** How much the state of the company's systems lets the team actually earn. */
export function systemsMultiplier(s: GameState) {
  const h = s.systems;
  let m = 0.55 + (0.45 * (h.product.health + h.sales.health)) / 200;
  if (h.billing.health < 40) m *= 0.85; // revenue leaks through broken invoices
  if (h.infra.health < 30) m *= 0.75; // outages
  return m;
}

export function quarterlyRevenue(s: GameState) {
  const mult = 1 + ownedUpgrades(s).reduce((a, u) => a + u.revenue, 0) - (s.office === "remote" ? 0.03 : 0);
  return Math.round(s.employees.length * REVENUE_PER_EMPLOYEE * (0.4 + s.morale / 100) * mult * systemsMultiplier(s));
}

export const payOf = (e: Employee) => e.salary * (e.contractor ? CONTRACTOR_RATE : 1);

export function quarterlyCosts(s: GameState) {
  const n = s.employees.length;
  return s.employees.reduce((a, e) => a + payOf(e), 0) + rent(s) + CEO_PAY + Math.max(0, n - 1) * LICENSE_COST;
}

export function valuation(s: GameState) {
  const arr = Math.max(quarterlyRevenue(s), 50_000) * 4;
  return Math.round(arr * 8 * (0.3 + s.hype / 40));
}

export function runwayQuarters(s: GameState) {
  const burn = quarterlyCosts(s) - quarterlyRevenue(s);
  return burn <= 0 ? Infinity : s.cash / burn;
}

export function employeeMood(s: GameState, e: Employee) {
  return clamp(s.morale + e.moodOffset);
}

export function hire(s: GameState, count: number) {
  let hired = 0;
  while (hired < count && s.employees.length < maxHeadcount(s)) {
    s.employees.push(makeEmployee(-1, s.quarter));
    hired++;
  }
  compactDesks(s);
  return hired;
}

/** How much someone resents you on the way out. */
function grudgeOf(s: GameState, e: Employee, reason: Alumnus["reason"]) {
  const broken = e.history.filter((h) => /broke|never paid|didn't pay/i.test(h)).length;
  const base = reason === "fired" ? 60 : reason === "laid off" ? 45 : 35;
  return clamp(base + broken * 15 - (employeeMood(s, e) - 50) / 3);
}

/** Someone leaves: they become an alumnus who remembers, and their systems are orphaned. */
export function removeEmployee(s: GameState, id: number, reason: Alumnus["reason"]): Employee | null {
  const idx = s.employees.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const [e] = s.employees.splice(idx, 1);
  const owned = ownedBy(s, e.id);
  for (const sys of owned) s.systems[sys].owner = null;
  remember(e, s.quarter, reason === "quit" ? "Quit. Couldn't take it anymore." : `Was ${reason} by the CEO.`);
  s.alumni.unshift({
    id: e.id,
    name: e.name,
    role: e.role,
    quirk: e.quirk,
    salary: e.salary,
    history: e.history,
    knowsZug: e.knowsZug,
    owned,
    leftQuarter: s.quarter,
    reason,
    grudge: grudgeOf(s, e, reason),
  });
  s.alumni.length = Math.min(s.alumni.length, 24);
  if (owned.length) log(s, `${e.name} took the only knowledge of ${owned.map((k) => SYSTEMS[k].name.toLowerCase()).join(" & ")} with them.`);
  compactDesks(s);
  return e;
}

export function removeEmployees(s: GameState, count: number, reason: Alumnus["reason"] = "quit"): Employee[] {
  const gone: Employee[] = [];
  for (let i = 0; i < count && s.employees.length > 0; i++) {
    const e = removeEmployee(s, s.employees[Math.floor(Math.random() * s.employees.length)].id, reason);
    if (e) gone.push(e);
  }
  if (gone.length && reason !== "quit") rememberAll(s, `Watched ${gone.map((g) => g.name.split(" ")[0]).join(", ")} get ${reason}.`);
  return gone;
}

// ---------- alumni, rehiring, whistleblowers ----------

export function rehireBlocker(s: GameState, a: Alumnus): string | null {
  if (s.employees.length >= maxHeadcount(s)) return "No room";
  if (a.refusedQuarter === s.quarter) return "Said no this quarter";
  if (a.blewWhistle) return "Talking to auditors";
  return null;
}

/** Bring someone back as a contractor (CONTRACTOR_RATE x pay). They get their systems back if still orphaned. */
export function rehire(s: GameState, alumnusId: number) {
  const i = s.alumni.findIndex((a) => a.id === alumnusId);
  if (i < 0) return;
  const [a] = s.alumni.splice(i, 1);
  const e: Employee = {
    id: a.id,
    name: a.name,
    role: a.role,
    quirk: a.quirk,
    moodOffset: -10,
    desk: -1,
    talkedQuarter: s.quarter,
    salary: a.salary,
    history: a.history,
    knowsZug: a.knowsZug,
    contractor: true,
  };
  remember(e, s.quarter, `Came back as a contractor at ${CONTRACTOR_RATE}x the old pay.`);
  s.employees.push(e);
  for (const sys of a.owned) if (s.systems[sys].owner === null) s.systems[sys].owner = e.id;
  compactDesks(s);
  log(s, `${a.name} is back as a contractor (${fmt(payOf(e))}/q). ${a.owned.length ? `${a.owned.map((k) => SYSTEMS[k].emoji).join("")} has an owner again.` : ""}`);
}

/** The person closest to the money notices the "consulting" invoices. */
export function noticeZug(s: GameState) {
  const ownerId = s.systems.billing.owner;
  const witness = s.employees.find((e) => e.id === ownerId) ?? s.employees.find((e) => ["Office Manager", "Data Scientist"].includes(e.role));
  if (!witness || witness.knowsZug) return;
  witness.knowsZug = true;
  remember(witness, s.quarter, "Processed a $250k 'consulting' invoice to a shell company in Zug. Kept a copy.");
}

// ---------- investor KPIs ----------

export const KPI_LABEL: Record<KpiMetric, string> = { revenue: "quarterly revenue", headcount: "headcount", valuation: "valuation", hype: "investor hype" };

export function kpiValue(s: GameState, m: KpiMetric) {
  return m === "revenue" ? quarterlyRevenue(s) : m === "headcount" ? s.employees.length : m === "valuation" ? valuation(s) : s.hype;
}

export function addKpi(s: GameState, quote: string, metric: KpiMetric, multiplier: number, quarters: number) {
  const baseline = kpiValue(s, metric);
  const mult = Math.max(1.05, Math.min(10, multiplier));
  const target = metric === "hype" ? Math.min(100, Math.round(baseline * mult)) : Math.round(baseline * mult);
  s.kpis.push({ quote, metric, baseline, target, dueQuarter: s.quarter + Math.max(2, Math.min(6, Math.round(quarters))) });
  log(s, `Investors wrote down: "${quote}" (${KPI_LABEL[metric]} ${metric === "revenue" || metric === "valuation" ? fmt(target) : target} by Q${s.quarter + Math.max(2, Math.min(6, Math.round(quarters)))}).`);
}

export function applyEffects(s: GameState, e: Effects): { hired: number; gone: Employee[] } {
  s.morale = clamp(s.morale + (e.morale ?? 0));
  s.hype = clamp(s.hype + (e.hype ?? 0));
  s.suspicion = clamp(s.suspicion + (e.suspicion ?? 0));
  s.cash += e.cash ?? 0;
  s.offshore += Math.max(0, e.offshore ?? 0);
  const hc = e.headcount ?? 0;
  if (hc > 0) return { hired: hire(s, hc), gone: [] };
  if (hc < 0) return { hired: 0, gone: removeEmployees(s, -hc, "quit") };
  return { hired: 0, gone: [] };
}

/** Compact state description fed to the LLM. */
export function describe(s: GameState) {
  const runway = runwayQuarters(s);
  return [
    `Company: ${s.company}, makes a ${s.product}. Quarter ${s.quarter}. CEO's company #${s.career}.`,
    `Employees: ${s.employees.length}. Morale ${s.morale}/100. Investor hype ${s.hype}/100. Board suspicion ${s.suspicion}/100.`,
    `Cash ${fmt(s.cash)}, runway ${runway === Infinity ? "profitable" : `${runway.toFixed(1)} quarters`}. Valuation ${fmt(valuation(s))}.`,
    `CEO secret offshore account: ${fmt(s.offshore)}. CEO reputation ${s.reputation}/100.`,
    `Office: ${office(s).name}${s.floors ? " (+ extra floor)" : ""}, ${capacity(s) === Infinity ? "no desks" : `${capacity(s)} desks`}${hotDeskers(s) ? `, ${hotDeskers(s)} people have no desk and are hot-desking on beanbags` : ""}.`,
    s.upgrades.length ? `Office perks the CEO bought: ${ownedUpgrades(s).map((u) => u.gossip).join(", ")}.` : "No office perks.",
    s.promises.length ? `Open CEO promises: ${s.promises.map((p) => `"${p.text}" due Q${p.dueQuarter}`).join("; ")}.` : "No open promises.",
    `Systems: ${SYSTEM_IDS.map((k) => {
      const o = s.employees.find((e) => e.id === s.systems[k].owner);
      return `${SYSTEMS[k].name} ${s.systems[k].health}/100 (${o ? `only ${o.name} understands it` : "NOBODY understands it"})`;
    }).join("; ")}.`,
    s.crises.length ? `ONGOING CRISES: ${s.crises.map((k) => SYSTEMS[k].crisis).join(" ")}` : "",
    s.kpis.length ? `Numbers the CEO promised investors: ${s.kpis.map((k) => `"${k.quote}" (due Q${k.dueQuarter})`).join("; ")}.` : "",
    s.alumni.length ? `Former employees: ${s.alumni.slice(0, 5).map((a) => `${a.name} (${a.reason} Q${a.leftQuarter}${a.atCompetitor ? ", now at a competitor" : ""}${a.grudge > 60 ? ", holds a grudge" : ""})`).join("; ")}.` : "",
    `Recent log: ${s.log.slice(0, 4).join(" | ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface QuarterReport {
  lines: string[];
  gone: Employee[];
}

/** Advance the economy by one quarter. */
export function endQuarter(s: GameState): QuarterReport {
  const lines: string[] = [];
  const gone: Employee[] = [];
  const rev = quarterlyRevenue(s);
  const cost = quarterlyCosts(s);
  s.cash += rev - cost;
  s.savings += CEO_PAY;
  s.lastRevenue = rev;
  lines.push(`Revenue ${fmt(rev)}, costs ${fmt(cost)} (incl. your ${fmt(CEO_PAY)} salary).`);

  // promises come due
  for (const p of s.promises.filter((p) => p.dueQuarter <= s.quarter)) {
    if (s.cash > p.cost * 2) {
      s.cash -= p.cost;
      s.morale = clamp(s.morale + 6);
      rememberAll(s, `CEO actually kept a promise: "${p.text}".`);
      lines.push(`You actually kept a promise: "${p.text}" (${fmt(p.cost)}). People are shocked.`);
    } else {
      s.morale = clamp(s.morale - 18);
      s.reputation = clamp(s.reputation - 4);
      rememberAll(s, `CEO broke a promise: "${p.text}". Never paid.`);
      lines.push(`Broken promise: "${p.text}". Someone printed your old email and taped it to the fridge.`);
    }
  }
  s.promises = s.promises.filter((p) => p.dueQuarter > s.quarter);

  // drift, office and perks
  const perks = ownedUpgrades(s);
  const perkMorale = perks.reduce((a, u) => a + u.morale, 0) + office(s).moralePerQ;
  const perkHype = perks.reduce((a, u) => a + u.hype, 0) + office(s).hypePerQ;
  s.morale = clamp(s.morale - 3 + perkMorale);
  s.hype = clamp(s.hype - 5 + (rev > cost ? 4 : 0) + perkHype);
  s.suspicion = clamp(s.suspicion - 4);
  if (perkMorale || perkHype) lines.push(`Office & perks: morale ${perkMorale >= 0 ? "+" : ""}${perkMorale}, hype ${perkHype >= 0 ? "+" : ""}${perkHype}.`);

  // hot-desking
  const homeless = hotDeskers(s);
  if (homeless > 0) {
    const pain = Math.min(12, homeless * 2);
    s.morale = clamp(s.morale - pain);
    lines.push(`${homeless} people still have no desk. The beanbag waitlist is a Jira board now. Morale -${pain}.`);
  }

  stepSystems(s, lines);
  stepAlumni(s, lines);
  stepKpis(s, lines);

  // attrition
  if (s.morale < 25 && s.employees.length > 0) {
    const n = Math.max(1, Math.round(s.employees.length * (s.morale < 12 ? 0.4 : 0.15)));
    const quit = removeEmployees(s, n, "quit");
    gone.push(...quit);
    lines.push(`${quit.map((e) => e.name).join(", ")} quit. Their farewell Slack messages were... pointed.`);
  }

  // audit
  if (s.suspicion > 50 && Math.random() < (s.suspicion - 50) / 40) {
    if (s.suspicion >= 75) {
      s.over = {
        win: false,
        canContinue: false,
        title: "Arrested at the airport",
        text: `Auditors followed the money to your offshore account (${fmt(s.offshore)}). You get a Netflix documentary instead of FIRE.`,
      };
      return { lines, gone };
    }
    s.suspicion = clamp(s.suspicion - 25);
    s.hype = clamp(s.hype - 12);
    s.reputation = clamp(s.reputation - 5);
    lines.push("Surprise audit! They found nothing conclusive. Investors are spooked anyway.");
  }

  if (netWorth(s) >= FIRE_TARGET) {
    s.over = {
      win: true,
      canContinue: false,
      title: "FIRE achieved",
      text: `Net worth ${fmt(netWorth(s))}. You announce you're "stepping back to spend time with family" and move to Madeira. ${s.company} sends a cake.`,
    };
    return { lines, gone };
  }
  if (s.cash < 0) {
    s.reputation = clamp(s.reputation - 20);
    s.over = {
      win: false,
      canContinue: s.reputation >= 20,
      title: `${s.company} ran out of money`,
      text:
        s.reputation >= 20
          ? `The company is dead. You post "What an incredible journey" on LinkedIn. Reputation ${s.reputation}/100 - someone will still hire you.`
          : "The company is dead and your reputation is radioactive. Not even a crypto startup will hire you.",
    };
    return { lines, gone };
  }
  if (s.employees.length === 0) {
    s.reputation = clamp(s.reputation - 15);
    s.over = {
      win: false,
      canContinue: s.reputation >= 20,
      title: "Everyone left",
      text: "You are now CEO of an empty office and a very expensive coffee machine.",
    };
    return { lines, gone };
  }

  s.quarter++;
  s.actionsLeft = ACTIONS_PER_QUARTER;
  return { lines, gone };
}

// ---------- quarterly steps ----------

/** Systems drift toward their owner's care; orphaned ones rot. Crossing 30 is a crisis the board hears about. */
function stepSystems(s: GameState, lines: string[]) {
  for (const k of SYSTEM_IDS) {
    const sys = s.systems[k];
    const owner = s.employees.find((e) => e.id === sys.owner);
    if (!owner) sys.owner = null;
    if (owner) {
      const mood = employeeMood(s, owner);
      sys.health = clamp(sys.health + (owner.contractor ? 12 : 4 + Math.round((mood - 50) / 8)));
    } else {
      sys.health = clamp(sys.health - 15);
      // someone may reluctantly adopt it (with a learning curve)
      const free = s.employees.filter((e) => !ownedBy(s, e.id).length && SYSTEMS[k].roles.includes(e.role));
      if (free.length && Math.random() < 0.35) {
        const e = pick(free);
        makeOwner(s, k, e);
        sys.health = clamp(sys.health - 5);
        lines.push(`${e.name} reluctantly adopted ${SYSTEMS[k].name.toLowerCase()} after reading a 2019 README.`);
      } else lines.push(`${SYSTEMS[k].emoji} ${SYSTEMS[k].name}: nobody understands it anymore (health ${sys.health}).`);
    }
    if (sys.health < 30 && !s.crises.includes(k)) {
      s.crises.push(k);
      const hit: Record<SystemId, Effects> = {
        infra: { cash: -120_000, hype: -10 },
        billing: { cash: -150_000, suspicion: 5 },
        product: { hype: -8, morale: -6 },
        sales: { hype: -6, morale: -3 },
      };
      applyEffects(s, hit[k]);
      s.boardDemands.push(`${SYSTEMS[k].emoji} ${SYSTEMS[k].crisis}`);
      rememberAll(s, `Lived through the ${SYSTEMS[k].name.toLowerCase()} crisis.`);
      lines.push(`🚨 CRISIS: ${SYSTEMS[k].crisis} The board wants answers.`);
    } else if (sys.health >= 50 && s.crises.includes(k)) {
      s.crises = s.crises.filter((c) => c !== k);
      lines.push(`✅ ${SYSTEMS[k].name} crisis is over.`);
    }
  }
}

/** Former employees don't just disappear. */
function stepAlumni(s: GameState, lines: string[]) {
  for (const a of s.alumni) {
    if (a.knowsZug && a.grudge >= 50 && !a.blewWhistle) {
      a.blewWhistle = true;
      s.suspicion = clamp(s.suspicion + 22);
      s.boardDemands.push(`📂 ${a.name} (ex-${a.role}) sent the auditors a 40-page PDF about "consulting fees" to Zug.`);
      lines.push(`📂 ${a.name} blew the whistle on the Zug invoices. Suspicion +22.`);
      continue;
    }
    if (a.grudge >= 60 && !a.reviewed && Math.random() < 0.4) {
      a.reviewed = true;
      s.hype = clamp(s.hype - 4);
      s.morale = clamp(s.morale - 3);
      lines.push(`⭐ ${a.name} left a 1-star Glassdoor review. It's very specific.`);
    }
    if (a.owned.length && !a.atCompetitor && s.quarter - a.leftQuarter >= 1 && Math.random() < 0.25) {
      a.atCompetitor = true;
      s.hype = clamp(s.hype - 4);
      lines.push(`🏃 ${a.name} joined a competitor. They shipped your roadmap in three weeks.`);
    }
    a.grudge = clamp(a.grudge - 4);
  }
  // employees who know about Zug and hate you might leak while still on payroll
  for (const e of s.employees) {
    if (e.knowsZug && employeeMood(s, e) < 25 && Math.random() < 0.3) {
      s.suspicion = clamp(s.suspicion + 10);
      remember(e, s.quarter, "Forwarded the Zug invoice to a journalist 'by accident'.");
      lines.push(`📨 Someone forwarded a Zug invoice to a journalist. Suspicion +10.`);
    }
  }
}

/** Numbers you promised investors come due. */
function stepKpis(s: GameState, lines: string[]) {
  for (const k of s.kpis.filter((x) => x.dueQuarter <= s.quarter)) {
    const v = kpiValue(s, k.metric);
    if (v >= k.target) {
      s.hype = clamp(s.hype + 8);
      s.reputation = clamp(s.reputation + 3);
      lines.push(`🎯 You actually hit "${k.quote}". Investors are suspicious of how happy they are.`);
    } else {
      const ratio = v / Math.max(1, k.target);
      s.hype = clamp(s.hype - (ratio < 0.5 ? 18 : 10));
      s.reputation = clamp(s.reputation - 3);
      s.boardDemands.push(`📉 You told investors "${k.quote}". You delivered ${Math.round(ratio * 100)}% of it.`);
      lines.push(`📉 Missed KPI: "${k.quote}" (${Math.round(ratio * 100)}% of target).`);
    }
  }
  s.kpis = s.kpis.filter((x) => x.dueQuarter > s.quarter);
}

/** Honest exit: IPO pays out the CEO's equity. */
export function canIPO(s: GameState) {
  return s.quarter >= 6 && valuation(s) >= IPO_VALUATION && s.cash > 0;
}

export function ipo(s: GameState) {
  const payout = Math.round(valuation(s) * s.equity);
  s.savings += payout;
  s.reputation = clamp(s.reputation + 20);
  s.over = {
    win: netWorth(s) >= FIRE_TARGET,
    canContinue: netWorth(s) < FIRE_TARGET,
    title: "IPO! The bell has been rung",
    text: `${s.company} went public at ${fmt(valuation(s))}. Your ${(s.equity * 100).toFixed(1)}% stake is worth ${fmt(payout)}.${netWorth(s) >= FIRE_TARGET ? " FIRE achieved - you never open Slack again." : " Not enough for FIRE yet... time for another company."}`,
  };
}
