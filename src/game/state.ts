// Rule-based simulation core (with a few dice rolls: audits, who gets laid off).
// The LLM only proposes deltas; this module applies and clamps them, runs the quarterly
// economy, company systems, people's memories and grudges, investor KPIs and win/lose.

import {
  FLOOR_COST,
  FLOOR_DESKS,
  FLOOR_RENT,
  HOT_DESK_OVERFLOW,
  MAX_HEADCOUNT,
  NOVELTY_QUARTERS,
  OFFICES,
  upgradeById,
  type OfficeTier,
  type UpgradeSpec,
} from "./office";
import { describeLifestyle, expenseSuspicion, lifestyleEffects, ownedItem, type LifestyleItem, type Owned, type Payer } from "./lifestyle";
import { bureaucracyDrag, ceoSpan, delegates, teamOutput, cSuiteHype, CEO_SPAN, describeOrg, orphanReports, placeHire, reportsOf, stepOrg, titleOf, type Title } from "./org";

export const FIRE_TARGET = 5_000_000;
export const ACTIONS_PER_QUARTER = 2;
export const IPO_VALUATION = 100_000_000;

const REVENUE_PER_EMPLOYEE = 38_000;
const CONTRACTOR_RATE = 3;
const KEY_PERSON_PREMIUM = 20_000;
/** What you pay yourself, unless the board froze it. */
export const ceoPay = (s: GameState) => ((s.payFrozenUntil ?? 0) > s.quarter ? 0 : s.ceoSalary);
export const CEO_SALARY_STEPS = [0, 10_000, 20_000, 35_000, 60_000, 100_000, 150_000, 250_000];
/** What a board would call a reasonable CEO salary for a company this size. */
export const fairCeoPay = (s: GameState) => Math.max(10_000, Math.min(150_000, Math.round((valuation(s) * 0.003) / 5_000) * 5_000));
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
  managerId?: number | null; // null/undefined = reports to the CEO
  title?: Title;
  payQuarter?: number; // last quarter the CEO changed their pay
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

/** Recurring characters who follow the CEO from company to company. */
export interface CastMember {
  name: string;
  role: string;
  history: string[];
}

/** A storyline that unfolds over several quarters' events. */
export interface Thread {
  title: string;
  episodes: string[]; // what happened in each episode, including what the CEO chose
  lastQuarter: number;
  open: boolean;
}

export const MAX_OPEN_THREADS = 2;
export const MAX_EPISODES = 4;

const DEFAULT_CAST: CastMember[] = [
  { name: "Chad Brennan", role: "lead investor at Fleece Ventures, always in a vest", history: [] },
  { name: "Priya Raman", role: "tech journalist at TechCrunchy who has been following your career", history: [] },
  { name: "Herr Brunner", role: "private banker in Zug, extremely discreet, extremely expensive", history: [] },
];

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
  formerly: string[]; // previous names and products, newest first
  founding?: string; // LLM-written origin story
  genesisDone?: boolean;
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
  customUpgrades: UpgradeSpec[]; // LLM-invented perks the CEO bought
  shopOffers?: { quarter: number; items: UpgradeSpec[] }; // this quarter's specials
  upgradeBought: Record<string, number>; // quarter each perk was bought, for the novelty to wear off
  employees: Employee[];
  promises: PromiseItem[];
  systems: Record<SystemId, SystemState>;
  crises: SystemId[];
  alumni: Alumnus[];
  kpis: Kpi[];
  boardDemands: string[]; // reasons the board wants to see you next quarter
  cast: CastMember[];
  threads: Thread[];
  liquidationPref: number; // paid to investors before you see a cent on exit
  guarantee: number; // what you personally owe if the company dies
  ceoSalary: number; // per quarter, set by you
  lifestyle: Owned[]; // what the CEO bought, and who paid
  lifestyleOffers?: { quarter: number; items: LifestyleItem[] }; // this quarter's catalogue
  expensed: number; // lifestyle put on this company's card, not yet found by auditors
  cfo?: string; // the board's CFO, if they appointed one
  payFrozenUntil?: number; // the board froze your salary until this quarter
  recentMotions?: string[]; // what the board voted on lately, newest first
  lastBoardVote: number;
  audits: number; // audits survived at this company; auditors keep a file
  zugTransfers: number; // "consulting fees" paid at this company
  actionsLeft: number;
  lastPartyQuarter: number;
  lastRaiseQuarter: number;
  lastMediaQuarter: number;
  lastRevenue: number;
  eventResolvedQuarter: number; // quarter whose random event has been played
  recentEvents: string[];
  log: string[];
  over?: { win: boolean; title: string; text: string; canContinue: boolean };
}

const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Kai", "Robin", "Skyler", "Charlie", "Dana", "Emery", "Frankie", "Harper", "Jesse"];
const LAST = ["Kowalski", "Nguyen", "Smith", "Garcia", "Müller", "Rossi", "Okafor", "Novak", "Silva", "Kim", "Patel", "Dubois", "Larsen", "Cohen"];
export const ROLES = ["Frontend Dev", "Backend Dev", "Product Manager", "QA Engineer", "Designer", "Data Scientist", "Sales Rep", "HR Partner", "DevOps", "Scrum Master", "Growth Hacker", "Office Manager"];
const QUIRKS = [
  "has been waiting for a raise for three years",
  "writes Rust after hours and mentions it constantly",
  "has four monitors and uses one",
  "asks about English lessons reimbursement every week",
  "is secretly interviewing at a competitor",
  "keeps a spreadsheet of every promise the CEO made",
  "thinks every problem can be solved with Kubernetes",
  "has never once turned the camera on",
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

export const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
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
    s.upgradeBought ??= {};
    s.customUpgrades ??= [];
    s.liquidationPref ??= 0;
    s.lastMediaQuarter ??= -10;
    s.lastBoardVote ??= 0;
    s.ceoSalary ??= 20_000;
    s.lifestyle ??= [];
    s.expensed ??= 0;
    s.guarantee ??= 0;
    s.formerly ??= [];
    for (const e of s.employees) {
      e.salary ??= 45_000;
      e.history ??= [];
    }
    s.alumni ??= [];
    s.kpis ??= [];
    s.boardDemands ??= [];
    s.crises ??= [];
    s.cast ??= structuredClone(DEFAULT_CAST);
    s.threads ??= [];
    s.audits ??= 0;
    s.zugTransfers ??= 0;
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

export function makeEmployee(desk: number, quarter: number): Employee {
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

export function findEmployee(s: GameState, name: string) {
  const n = name.trim().toLowerCase();
  return s.employees.find((e) => e.name.toLowerCase() === n) ?? s.employees.find((e) => n.includes(e.name.split(" ")[0].toLowerCase()));
}

export interface PersonEffect {
  name: string;
  memory: string;
  salary_change: number;
  mood_change: number;
  new_quirk: string;
  leaves?: boolean;
}

/** Apply what happened to specific named people. Returns lines for the UI (and how many walked out). */
export function applyPeople(s: GameState, people: PersonEffect[] = []) {
  const lines: string[] & { left?: number } = [];
  lines.left = 0;
  for (const p of people) {
    const e = findEmployee(s, p.name);
    if (!e) {
      const c = s.cast.find((x) => x.name.toLowerCase() === p.name.trim().toLowerCase());
      if (c && p.memory) {
        remember(c, s.quarter, p.memory);
        lines.push(`${c.name}: ${p.memory}`);
      }
      continue;
    }
    if (p.memory) remember(e, s.quarter, p.memory);
    if (p.salary_change) e.salary = Math.max(25_000, e.salary + p.salary_change);
    if (p.mood_change) e.moodOffset = clamp(e.moodOffset + p.mood_change, -50, 50);
    if (p.new_quirk) e.quirk = p.new_quirk.replace(/^(they|he|she)\s+/i, "");
    lines.push(`${e.name}: ${p.memory}${p.salary_change ? ` (${p.salary_change > 0 ? "+" : ""}${fmt(p.salary_change)}/q)` : ""}${p.leaves ? " — and left." : ""}`);
    if (p.leaves) {
      removeEmployee(s, e.id, "quit");
      lines.left++;
    }
  }
  return lines;
}

/** Where your next CEO gig starts depends on how the last one went. */
function startingOffice(prev?: GameState): { office: OfficeTier; staff: number; cash: number } {
  if (!prev) return { office: "garage", staff: 3, cash: 600_000 };
  if (prev.reputation >= 70) return { office: "openspace", staff: 10, cash: 3_500_000 };
  if (prev.reputation >= 45) return { office: "cowork", staff: 6, cash: 1_800_000 };
  return { office: "garage", staff: 3, cash: 700_000 };
}

export function newCompany(prev?: GameState): GameState {
  const start = startingOffice(prev);
  const s: GameState = {
    company: `${pick(PREFIX)}${pick(SUFFIX)} Inc.`,
    product: pick(PRODUCTS),
    formerly: [],
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
    upgradeBought: {},
    customUpgrades: [],
    employees: [],
    promises: [],
    systems: freshSystems(),
    crises: [],
    alumni: [],
    kpis: [],
    boardDemands: [],
    // board seats stay with the old company; the people stay in your life
    cast: prev ? prev.cast.map((c) => (/sits on your board/.test(c.role) ? { ...c, role: `partner at a fund; used to sit on your board at ${prev.company}` } : c)) : structuredClone(DEFAULT_CAST),
    threads: [],
    liquidationPref: 0,
    guarantee: 0,
    lastBoardVote: 0,
    ceoSalary: prev?.ceoSalary ?? 20_000,
    // the car and the penthouse come with you; the old company's card doesn't
    lifestyle: (prev?.lifestyle ?? []).map((o) => ({ ...o, payer: "self" as const })),
    expensed: 0,
    audits: 0,
    zugTransfers: 0,
    actionsLeft: ACTIONS_PER_QUARTER,
    lastPartyQuarter: -10,
    lastRaiseQuarter: -10,
    lastMediaQuarter: -10,
    lastRevenue: 0,
    eventResolvedQuarter: 0,
    recentEvents: [],
    log: [],
  };
  for (let i = 0; i < start.staff; i++) s.employees.push(makeEmployee(i, 1));
  assignOwners(s);
  // the angriest person you left behind now runs a competitor
  const nemesis = prev?.alumni.filter((a) => a.grudge >= 50 && !s.cast.some((c) => c.name === a.name)).sort((a, b) => b.grudge - a.grudge)[0];
  if (nemesis) {
    s.cast.push({ name: nemesis.name, role: `CEO of a competitor; used to work for you at ${prev!.company} until you ${nemesis.reason === "quit" ? "drove them out" : nemesis.reason === "fired" ? "fired them" : "laid them off"}`, history: nemesis.history.slice(-4) });
    log(s, `Your former employee ${nemesis.name} now runs a competitor. They have a long memory.`);
  }
  log(
    s,
    prev
      ? `You land a new CEO gig at ${s.company} (${OFFICES[s.office].name.toLowerCase()}). Nobody checked your references.`
      : `Welcome, CEO of ${s.company} Product: ${s.product}.`,
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

/** Built-in perk, one the CEO bought from the specials, or one on offer this quarter. */
export const findUpgrade = (s: GameState, id: string) => upgradeById(id) ?? s.customUpgrades.find((u) => u.id === id) ?? s.shopOffers?.items.find((u) => u.id === id);

const ownedUpgrades = (s: GameState) => s.upgrades.flatMap((id) => findUpgrade(s, id) ?? []);

/** Per-quarter morale/hype of a perk: full while it's new, then the upside halves. The downsides never fade. */
export function perkEffect(s: GameState, u: UpgradeSpec) {
  const old = isOldNews(s, u.id);
  const fade = (v: number) => (old && v > 0 ? Math.floor(v / 2) : v);
  return { morale: fade(u.morale), hype: fade(u.hype) };
}

export const isOldNews = (s: GameState, id: string) => s.quarter - (s.upgradeBought[id] ?? 0) >= NOVELTY_QUARTERS;

export const upkeepOf = (s: GameState, u: UpgradeSpec) => (u.perHead ? u.upkeep * s.employees.length : u.upkeep);

export function upgradeCost(s: GameState, id: string) {
  const u = findUpgrade(s, id)!;
  return u.perHead ? u.cost * Math.max(1, s.employees.length) : u.cost;
}

/** Why an upgrade can't be bought right now, or null if it can. */
export function upgradeBlocker(s: GameState, id: string): string | null {
  const u = findUpgrade(s, id);
  if (!u) return "Unknown";
  if (s.upgrades.includes(id)) return "Owned";
  if (s.office === "remote" && u.remote === "no") return "Needs an office";
  if (s.office !== "remote" && u.remote === "only") return "Remote only";
  if (s.upgrades.length >= office(s).upgradeSlots) return "No space left";
  if (s.cash < upgradeCost(s, id)) return "Can't afford";
  return null;
}

export function buyUpgrade(s: GameState, id: string) {
  const u = findUpgrade(s, id)!;
  const cost = upgradeCost(s, id);
  s.cash -= cost;
  s.upgrades.push(id);
  s.upgradeBought[id] = s.quarter;
  if (!upgradeById(id) && !s.customUpgrades.some((x) => x.id === id)) s.customUpgrades.push(u);
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
    const u = findUpgrade(s, id)!;
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
    log(s, `Went remote-first. The office is now a Notion page. ${lost.length ? `Left behind: ${lost.map((id) => findUpgrade(s, id)!.emoji).join(" ")}.` : ""}`);
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
  const mult = 1 + ownedUpgrades(s).reduce((a, u) => a + u.revenue, 0) - (s.office === "remote" ? 0.03 : 0) - bureaucracyDrag(s);
  return Math.round(teamOutput(s, (e) => employeeMood(s, e)) * REVENUE_PER_EMPLOYEE * (0.4 + s.morale / 100) * mult * systemsMultiplier(s));
}

export const payOf = (e: Employee) => e.salary * (e.contractor ? CONTRACTOR_RATE : 1);

/** Where the money goes each quarter, line by line. */
export function costBreakdown(s: GameState) {
  return {
    payroll: s.employees.reduce((a, e) => a + payOf(e), 0),
    rent: rent(s),
    perks: ownedUpgrades(s).reduce((a, u) => a + upkeepOf(s, u), 0),
    you: ceoPay(s),
    lifestyle: lifestyleUpkeep(s, "company"),
    saas: Math.max(0, s.employees.length - 1) * LICENSE_COST,
  };
}

export function quarterlyCosts(s: GameState) {
  return Object.values(costBreakdown(s)).reduce((a, b) => a + b, 0);
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
    const e = makeEmployee(-1, s.quarter);
    s.employees.push(e);
    placeHire(s, e);
    hired++;
  }
  compactDesks(s);
  return hired;
}

export type HirePerk = "none" | "signing" | "options" | "title";

export const HIRE_PERKS: Record<HirePerk, { label: string; blurb: string }> = {
  none: { label: "Just the salary", blurb: "Clean and honest." },
  signing: { label: "$20k signing bonus", blurb: "Paid today from company cash." },
  options: { label: "0.5% stock options", blurb: "Comes out of your own stake." },
  title: { label: "Team Lead title", blurb: "Day one. Everyone who's been here longer will notice." },
};

export const RECRUIT_FEE = 15_000;

/** A candidate said yes. They arrive with a name, a past and a memory of how they were hired. */
export function hireCandidate(
  s: GameState,
  c: { name: string; role: string; quirk: string; ask: number },
  salary: number,
  perk: HirePerk,
  memory: string,
): Employee {
  const e = makeEmployee(-1, s.quarter);
  Object.assign(e, { name: c.name, role: c.role, quirk: c.quirk, salary, moodOffset: Math.round((salary / c.ask - 1) * 60) + 5 });
  if (perk === "signing") s.cash -= 20_000;
  if (perk === "options") {
    s.equity = Math.max(0.01, s.equity - 0.005);
    e.moodOffset += 8;
  }
  if (perk === "title") {
    e.title = "lead";
    e.salary += 5_000;
  }
  remember(e, s.quarter, memory || `Got hired by the CEO at ${fmt(salary)}/q.`);
  s.employees.push(e);
  placeHire(s, e);
  compactDesks(s);
  // a new hire in the right role may adopt an orphaned system
  for (const sys of SYSTEM_IDS) if (s.systems[sys].owner === null && SYSTEMS[sys].roles.includes(e.role)) {
    makeOwner(s, sys, e);
    break;
  }
  return e;
}

export const lifestyleUpkeep = (s: GameState, payer: Payer) =>
  s.lifestyle.filter((o) => o.payer === payer).reduce((a, o) => a + (ownedItem(o)?.upkeep ?? 0), 0);

/** Why the CEO can't buy this right now, or null. */
export function lifestyleBlocker(s: GameState, it: LifestyleItem, payer: Payer): string | null {
  if (s.lifestyle.some((o) => o.id === it.id || ownedItem(o)?.name === it.name)) return "Owned";
  if (payer === "self" && s.savings < it.cost) return "Your savings say no";
  if (payer === "company" && s.cash < it.cost * 2) return "Even you can't justify it now";
  return null;
}

/** Buy something nice. Returns what happened, for the result screen. */
export function buyLifestyle(s: GameState, it: LifestyleItem, payer: Payer): string[] {
  const id = it.id;
  const out: string[] = [];
  s.lifestyle.push({ id, quarter: s.quarter, payer, item: it });
  s.hype = clamp(s.hype + it.hype);
  s.reputation = clamp(s.reputation + it.reputation);
  s.morale = clamp(s.morale + it.morale);
  if (payer === "self") {
    s.savings -= it.cost;
    log(s, `Bought ${it.emoji} ${it.name} for ${fmt(it.cost)} of your own money. FIRE just got a little further away.`);
    out.push(`${fmt(it.cost)} out of your savings.`);
  } else {
    const susp = expenseSuspicion(s, it);
    s.cash -= it.cost;
    s.expensed += it.cost;
    s.suspicion = clamp(s.suspicion + susp);
    log(s, `Expensed ${it.emoji} ${it.name} (${fmt(it.cost)}) to the company card as "client development".`);
    out.push(`${fmt(it.cost)} on the company card. Suspicion +${susp}.`);
    if (Math.random() < 0.35) {
      const who = s.employees.find((e) => ownedBy(s, e.id).includes("billing")) ?? pick(s.employees);
      if (who) {
        remember(who, s.quarter, `Saw the receipt: the CEO expensed ${it.gossip} to the company.`);
        s.morale = clamp(s.morale - 4);
        out.push(`${who.name} saw the receipt. By lunch, so had everyone. Morale −4.`);
      }
    }
  }
  return out;
}

/** Sell (or cancel) something. Money goes back where it came from; the team is quietly delighted. */
export function sellLifestyle(s: GameState, id: string): string {
  const i = s.lifestyle.findIndex((o) => o.id === id);
  if (i < 0) return "";
  const [o] = s.lifestyle.splice(i, 1);
  const it = ownedItem(o);
  if (!it) return "";
  const back = Math.round(it.cost * (it.resale ?? 0.4));
  if (o.payer === "company") {
    s.cash += back;
    s.expensed = Math.max(0, s.expensed - it.cost);
  } else s.savings += back;
  s.hype = clamp(s.hype - Math.ceil(it.hype / 3));
  s.morale = clamp(s.morale + Math.max(1, Math.ceil(-it.morale / 3)));
  rememberAll(s, `The CEO got rid of ${it.gossip}.`);
  log(s, `${back ? "Sold" : "Cancelled"} ${it.emoji} ${it.name}${back ? ` for ${fmt(back)}` : ""}. The team pretends not to have noticed.`);
  return back ? `${fmt(back)} back ${o.payer === "company" ? "to the company" : "to your savings"}.` : "Nothing back. Some things you can't resell.";
}

/** Sell an office perk for scrap. Taking away something people liked hurts more than never giving it. */
export function sellUpgrade(s: GameState, id: string): string {
  const u = findUpgrade(s, id);
  if (!u || !s.upgrades.includes(id)) return "";
  const back = Math.round(upgradeCost(s, id) * 0.3);
  s.upgrades = s.upgrades.filter((x) => x !== id);
  s.cash += back;
  const loved = Math.max(0, u.morale);
  if (loved) {
    s.morale = clamp(s.morale - loved * 2);
    rememberAll(s, `The CEO took away ${u.gossip}.`);
  }
  log(s, `Sold ${u.emoji} ${u.name} for ${fmt(back)}.${loved ? " People noticed." : ""}`);
  return `${fmt(back)} back.${loved ? ` Morale −${loved * 2}: people liked it.` : ""}`;
}

/** Pay yourself a new salary. Everyone hears about a big raise (or a cut to zero). */
export function setCeoSalary(s: GameState, amount: number) {
  const before = s.ceoSalary;
  s.ceoSalary = Math.max(0, amount);
  if (amount > before * 1.25 && amount - before >= 10_000) {
    rememberAll(s, `CEO gave themselves a raise: ${fmt(before)} → ${fmt(amount)} a quarter.`);
    log(s, `You raised your own salary to ${fmt(amount)}/q. Finance has opinions; so does Slack.`);
  } else if (amount === 0 && before > 0) {
    rememberAll(s, "CEO cut their own salary to zero.");
    s.morale = clamp(s.morale + 5);
    log(s, "You cut your own salary to $0. LinkedIn post drafted, not yet posted.");
  } else log(s, `Your salary is now ${fmt(amount)}/q.`);
}

/** The board and the team compare your salary to the company's size every quarter. */
function stepCeoPay(s: GameState): string[] {
  const pay = ceoPay(s);
  const fair = fairCeoPay(s);
  const excess = pay - fair;
  if (excess > 5_000) {
    const susp = Math.min(8, Math.ceil(excess / 20_000));
    const sour = Math.min(6, Math.ceil(excess / 30_000));
    s.suspicion = clamp(s.suspicion + susp);
    s.morale = clamp(s.morale - sour);
    return [`Your ${fmt(pay)} salary vs ~${fmt(fair)} for a company this size: the board noticed (suspicion +${susp}), so did the team (morale −${sour}).`];
  }
  if (pay <= fair / 2 && (s.payFrozenUntil ?? 0) <= s.quarter) {
    s.morale = clamp(s.morale + 1);
    return [`You pay yourself ${fmt(pay)} on a company that could justify ${fmt(fair)}. The team notices. Morale +1.`];
  }
  return [];
}

/** A pay change from the CEO, effective now. Returns how it landed. */
export function adjustPay(s: GameState, e: Employee, pct: number) {
  const delta = Math.round((e.salary * pct) / 100 / 1000) * 1000;
  e.salary = Math.max(20_000, e.salary + delta);
  e.payQuarter = s.quarter;
  if (pct > 0) {
    e.moodOffset = clamp(e.moodOffset + Math.round(pct * 0.8), -50, 50);
    remember(e, s.quarter, `Got a ${pct}% raise from the CEO (${fmt(e.salary)}/q).`);
    if (/raise/i.test(e.quirk)) e.quirk = "finally got the raise and is now asking about a title";
    log(s, `Gave ${e.name} a ${pct}% raise (+${fmt(delta)}/q).`);
  } else {
    e.moodOffset = clamp(e.moodOffset - 20, -50, 50);
    remember(e, s.quarter, `The CEO cut my pay by ${-pct}%. To ${fmt(e.salary)}/q.`);
    log(s, `Cut ${e.name}'s pay by ${-pct}% (${fmt(delta)}/q). They're updating their CV.`);
  }
  return delta;
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
  orphanReports(s, e);
  if (e.name === s.cfo) {
    s.cfo = undefined;
    if (reason !== "quit") s.boardDemands.push(`You ${reason === "fired" ? "fired" : "laid off"} ${e.name}, the CFO the board appointed.`);
  }
  const owned = ownedBy(s, e.id);
  const boss = e.managerId != null ? s.employees.find((m) => m.id === e.managerId) : undefined;
  for (const sys of owned) s.systems[sys].owner = boss?.id ?? null;
  if (boss && owned.length) {
    remember(boss, s.quarter, `Inherited ${owned.map((k) => SYSTEMS[k].name.toLowerCase()).join(" & ")} when ${e.name.split(" ")[0]} left.`);
    log(s, `${boss.name} took over ${owned.map((k) => SYSTEMS[k].name.toLowerCase()).join(" & ")} from ${e.name}. A manager who knows the team's work.`);
  }
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
  if (owned.length && !boss) log(s, `${e.name} took the only knowledge of ${owned.map((k) => SYSTEMS[k].name.toLowerCase()).join(" & ")} with them.`);
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
  placeHire(s, e);
  for (const sys of a.owned) if (s.systems[sys].owner === null) s.systems[sys].owner = e.id;
  compactDesks(s);
  log(s, `${a.name} is back as a contractor (${fmt(payOf(e))}/q). ${a.owned.length ? `${a.owned.map((k) => SYSTEMS[k].emoji).join("")} has an owner again.` : ""}`);
}

export const ZUG_AMOUNT = 250_000;
export const ZUG_FEE = 0.1; // Herr Brunner's discretion is not free
export const zugSuspicion = (s: GameState) => 10 + 3 * s.zugTransfers + (s.cfo && s.employees.some((e) => e.name === s.cfo) ? 6 : 0); // the pattern gets harder to miss

export type ZugScheme = "invoice" | "retreat" | "licensing" | "crypto";

export const ZUG_SCHEMES: Record<ZugScheme, { label: string; emoji: string; amount: number; fee: number; suspicion: number; blurb: string; brunner: string }> = {
  invoice: { label: "Strategic consulting invoice", emoji: "🧾", amount: ZUG_AMOUNT, fee: ZUG_FEE, suspicion: 1, blurb: "The classic. Billing will see the invoice.", brunner: "A classic. Like a good fondue." },
  retreat: { label: "Leadership retreat in the Alps", emoji: "🏔️", amount: 120_000, fee: 0.1, suspicion: 0.5, blurb: "Small and plausible. Until someone asks for the photos.", brunner: "A retreat. For one. How restorative." },
  licensing: { label: "IP licensing from a Cyprus subsidiary", emoji: "🏛️", amount: 600_000, fee: 0.15, suspicion: 1.8, blurb: "Big money, big paper trail. Auditors love a subsidiary.", brunner: "Cyprus. Bold. I will need to make some calls, which I bill hourly." },
  crypto: { label: "Treasury diversification into crypto", emoji: "🪙", amount: 300_000, fee: 0.05, suspicion: 1.2, blurb: "Investors find it visionary. Nobody can tell what happened. Including you.", brunner: "I do not touch crypto. My cousin does. He is in Liechtenstein." },
};

export const zugSchemeSuspicion = (s: GameState, k: ZugScheme) => Math.round(zugSuspicion(s) * ZUG_SCHEMES[k].suspicion);

/** Move company money to Zug. `cover` is the LLM-judged adjustment for the cover story (-5..+8). */
export function payZug(s: GameState, scheme: ZugScheme = "invoice", cover = 0) {
  const z = ZUG_SCHEMES[scheme];
  const susp = Math.max(1, zugSchemeSuspicion(s, scheme) + Math.max(-5, Math.min(8, Math.round(cover))));
  applyEffects(s, { cash: -z.amount, offshore: Math.round(z.amount * (1 - z.fee)), suspicion: susp, hype: scheme === "crypto" ? 3 : 0 });
  s.zugTransfers++;
  const brunner = s.cast.find((c) => c.name === "Herr Brunner");
  if (brunner) remember(brunner, s.quarter, `Received transfer #${s.zugTransfers} from ${s.company} (${z.label.toLowerCase()}, ${fmt(z.amount)}). Kept ${Math.round(z.fee * 100)}%.`);
  noticeZug(s);
  return susp;
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
/** Marks the end of the slow-changing part of describe(): the server caches everything above it. */
export const STATE_SPLIT = "\n<<<live>>>\n";

/**
 * The game state for the LLM, in two parts: what rarely changes (who everyone is, the story so far)
 * and the live numbers. Keeping the first part byte-identical between calls lets the API cache it.
 */
export function describe(s: GameState) {
  const runway = runwayQuarters(s);
  const stable = [
    `Company: ${s.company}. Product: ${s.product}.${s.founding ? ` Origin: ${s.founding}` : ""} CEO's company #${s.career}.${s.formerly.length ? ` Formerly: ${s.formerly.slice(0, 3).join("; ")}.` : ""}`,
    `Roster: ${s.employees
      .slice(0, 16)
      .map((e) => `${e.name} (${titleOf(e)}, ${e.quirk})`)
      .join("; ")}${s.employees.length > 16 ? ` and ${s.employees.length - 16} more` : ""}.`,
    describeOrg(s),
    `Recurring characters in the CEO's life: ${s.cast.map((c) => `${c.name} (${c.role})`).join("; ")}.`,
    s.alumni.length ? `Former employees: ${s.alumni.slice(0, 5).map((a) => `${a.name} (${a.reason} Q${a.leftQuarter}${a.atCompetitor ? ", now at a competitor" : ""}${a.grudge > 60 ? ", holds a grudge" : ""})`).join("; ")}.` : "",
    s.threads.some((t) => t.open) ? `Ongoing storylines: ${s.threads.filter((t) => t.open).map((t) => `"${t.title}" so far: ${t.episodes.join(" → ")}`).join(" || ")}.` : "",
    describeLifestyle(s),
    s.cfo && s.employees.some((e) => e.name === s.cfo) ? `${s.cfo} is the CFO the board appointed over the CEO's objection; he reports every outgoing payment to the board.` : "",
    s.liquidationPref || s.guarantee ? `Terms the CEO signed with investors:${s.liquidationPref ? ` ${fmt(s.liquidationPref)} liquidation preference;` : ""}${s.guarantee ? ` personally guaranteed ${fmt(s.guarantee)} of the debt;` : ""}`.replace(/;$/, ".") : "",
  ];
  const live = [
    `Quarter ${s.quarter}. Employees: ${s.employees.length}. Morale ${s.morale}/100. Investor hype ${s.hype}/100. Board suspicion ${s.suspicion}/100.`,
    `Cash ${fmt(s.cash)}, runway ${runway === Infinity ? "profitable" : `${runway.toFixed(1)} quarters`}. Valuation ${fmt(valuation(s))}.`,
    `CEO secret offshore account: ${fmt(s.offshore)}. CEO reputation ${s.reputation}/100.`,
    `Office: ${office(s).name}${s.floors ? " (+ extra floor)" : ""}, ${capacity(s) === Infinity ? "no desks" : `${capacity(s)} desks`}${hotDeskers(s) ? `, ${hotDeskers(s)} people have no desk and are hot-desking on beanbags` : ""}.`,
    `Moods and pay: ${s.employees
      .slice(0, 16)
      .map((e) => `${e.name.split(" ")[0]} ${employeeMood(s, e)} (${fmt(payOf(e))}/q)`)
      .join(", ")}.`,
    (s.payFrozenUntil ?? 0) > s.quarter ? `The board froze the CEO's salary until Q${s.payFrozenUntil}.` : `The CEO pays themselves ${fmt(s.ceoSalary)} a quarter (a board would call ~${fmt(fairCeoPay(s))} reasonable here).`,
    s.upgrades.length ? `Office perks the CEO bought: ${ownedUpgrades(s).map((u) => (isOldNews(s, u.id) ? `${u.gossip} (old news, nobody cares anymore)` : `${u.gossip} (new)`)).join(", ")}.` : "No office perks.",
    s.promises.length ? `Open CEO promises: ${s.promises.map((p) => `"${p.text}" due Q${p.dueQuarter}`).join("; ")}.` : "No open promises.",
    `Systems: ${SYSTEM_IDS.map((k) => {
      const o = s.employees.find((e) => e.id === s.systems[k].owner);
      return `${SYSTEMS[k].name} ${s.systems[k].health}/100 (${o ? `only ${o.name} understands it` : "NOBODY understands it"})`;
    }).join("; ")}.`,
    s.crises.length ? `ONGOING CRISES: ${s.crises.map((k) => SYSTEMS[k].crisis).join(" ")}` : "",
    s.kpis.length ? `Numbers the CEO promised investors: ${s.kpis.map((k) => `"${k.quote}" (due Q${k.dueQuarter})`).join("; ")}.` : "",
    s.cast.some((c) => c.history.length) ? `What the recurring characters remember: ${s.cast.filter((c) => c.history.length).map((c) => `${c.name}: ${c.history.slice(-2).join(" / ")}`).join("; ")}.` : "",
    `Recent log: ${s.log.slice(0, 4).join(" | ")}`,
  ];
  return stable.filter(Boolean).join("\n") + STATE_SPLIT + live.filter(Boolean).join("\n");
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
  s.savings += ceoPay(s);
  s.lastRevenue = rev;
  lines.push(`Revenue ${fmt(rev)}, costs ${fmt(cost)} (incl. your ${fmt(ceoPay(s))} salary).`);

  // promises come due (a $0 "promise" can't be kept or broken - old saves may have some)
  for (const p of s.promises.filter((p) => p.dueQuarter <= s.quarter && p.cost > 0)) {
    const to = /\(to (.+)\)$/.exec(p.text)?.[1];
    const person = to ? s.employees.find((e) => e.name === to) : undefined;
    if (s.cash > p.cost * 2) {
      s.cash -= p.cost;
      s.morale = clamp(s.morale + (person ? 2 : 6));
      if (person) {
        person.moodOffset = clamp(person.moodOffset + 15, -50, 50);
        remember(person, s.quarter, `CEO actually kept their promise to me: "${p.text.replace(/ \(to .+\)$/, "")}".`);
        if (/raise|salary|pay|bonus|compensation/i.test(p.text) && /raise|salary|pay rise|compensation/i.test(p.text)) {
          person.salary += Math.min(30_000, Math.round(p.cost / 4));
          if (/raise/i.test(person.quirk)) person.quirk = "finally got the raise and is now asking about a title";
        }
      } else rememberAll(s, `CEO actually kept a promise: "${p.text}".`);
      lines.push(`You actually kept a promise: "${p.text}" (${fmt(p.cost)}). People are shocked.`);
    } else {
      s.morale = clamp(s.morale - 18);
      s.reputation = clamp(s.reputation - 4);
      if (person) {
        person.moodOffset = clamp(person.moodOffset - 20, -50, 50);
        remember(person, s.quarter, `CEO broke their promise to me: "${p.text.replace(/ \(to .+\)$/, "")}". Never paid.`);
      } else rememberAll(s, `CEO broke a promise: "${p.text}". Never paid.`);
      lines.push(`Broken promise: "${p.text}". Someone printed your old email and taped it to the fridge.`);
    }
  }
  s.promises = s.promises.filter((p) => p.dueQuarter > s.quarter);

  // drift, office and perks
  const perks = ownedUpgrades(s);
  const perkMorale = perks.reduce((a, u) => a + perkEffect(s, u).morale, 0) + office(s).moralePerQ;
  const perkHype = perks.reduce((a, u) => a + perkEffect(s, u).hype, 0) + office(s).hypePerQ;
  s.morale = clamp(s.morale - 3 + perkMorale);
  s.hype = clamp(s.hype - 5 + (rev > cost ? 4 : 0) + perkHype + cSuiteHype(s));
  lines.push(...stepOrg(s, (e) => employeeMood(s, e)));
  lines.push(...stepCeoPay(s));
  const lf = lifestyleEffects(s);
  if (lf.hype || lf.morale || lf.reputation) {
    s.hype = clamp(s.hype + lf.hype);
    s.morale = clamp(s.morale + lf.morale);
    s.reputation = clamp(s.reputation + lf.reputation);
    lines.push(`Your lifestyle: hype ${lf.hype >= 0 ? "+" : ""}${lf.hype}, morale ${lf.morale >= 0 ? "+" : ""}${lf.morale}${lf.reputation ? `, reputation +${lf.reputation}` : ""}.`);
  }
  const own = lifestyleUpkeep(s, "self");
  if (own) {
    s.savings -= own;
    lines.push(`Your lifestyle cost you ${fmt(own)} of your own savings this quarter.`);
  }
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

  // audit: more likely the more suspicious you look and the thicker their file on you;
  // whether they find anything depends on suspicion and on whether someone talked
  const auditChance = s.suspicion > 40 ? (s.suspicion - 40) / 50 + s.audits * 0.05 : 0;
  if (Math.random() < auditChance) {
    s.audits++;
    const whistleblower = s.alumni.some((a) => a.blewWhistle);
    const findChance = s.offshore > 0 ? Math.max(0, (s.suspicion - 42) / 55) + (whistleblower ? 0.3 : 0) + (s.audits - 1) * 0.04 : 0;
    if (Math.random() < findChance) {
      s.over = {
        win: false,
        canContinue: false,
        title: "Arrested at the airport",
        text: `Auditors followed the money to your offshore account (${fmt(s.offshore)}).${whistleblower ? " Someone had kept copies of the invoices." : ""} You get a Netflix documentary instead of FIRE.`,
      };
      return { lines, gone };
    }
    if (s.expensed > 0 && Math.random() < Math.min(0.6, s.expensed / 400_000)) {
      const repay = Math.min(s.savings, s.expensed);
      s.savings -= repay;
      s.reputation = clamp(s.reputation - 10);
      s.boardDemands.push(`Auditors found ${fmt(s.expensed)} of personal lifestyle on the company card.`);
      lines.push(`🧾 The auditors found your expenses (${fmt(s.expensed)}). You repay ${fmt(repay)} from your savings, and the board wants a word.`);
      s.expensed = 0;
    }
    s.suspicion = clamp(s.suspicion - 10);
    s.hype = clamp(s.hype - 12);
    s.reputation = clamp(s.reputation - 5);
    lines.push(`🔍 Audit #${s.audits}! They found nothing conclusive${s.offshore > 0 ? " — this time" : ""}. They're keeping the file open.`);
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
    const owed = Math.min(s.savings, s.guarantee);
    s.savings -= owed;
    s.over = {
      win: false,
      canContinue: s.reputation >= 20,
      title: `${s.company} ran out of money`,
      text:
        s.reputation >= 20
          ? `The company is dead. You post "What an incredible journey" on LinkedIn. Reputation ${s.reputation}/100 - someone will still hire you.${owed ? ` The personal guarantee you signed costs you ${fmt(owed)} of your own savings.` : ""}`
          : `The company is dead and your reputation is radioactive. Not even a crypto startup will hire you.${owed ? ` And the fund calls in your personal guarantee: ${fmt(owed)}.` : ""}`,
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
  if (ceoSpan(s) > CEO_SPAN) {
    s.actionsLeft--;
    lines.push(`${ceoSpan(s)} people report directly to you. Your calendar is wall-to-wall 1:1s: one decision fewer next quarter.`);
  } else if (delegates(s, (e) => employeeMood(s, e))) {
    s.actionsLeft++;
    lines.push(`🧭 Your managers run their teams without you. You get an extra decision next quarter.`);
  }
  if (lifestyleEffects(s).decisions) {
    s.actionsLeft += lifestyleEffects(s).decisions;
    lines.push("🛩️ The jet puts you in two cities a day: one extra decision.");
  }
  return { lines, gone };
}

// ---------- quarterly steps ----------

const INCIDENTS: Record<SystemId, string[]> = {
  infra: ["A certificate expired at 3am.", "Someone ran a migration on prod 'just to check'.", "The cloud bill doubled because of a forgotten GPU."],
  billing: ["Taxes in a new country. Nobody noticed for a month.", "A rounding bug paid a customer to use the product.", "Invoices went out in Comic Sans."],
  product: ["A redesign moved every button.", "A 'quick fix' broke onboarding.", "The roadmap was replaced by a Miro board nobody can open."],
  sales: ["The top client's champion left.", "A competitor undercut you by 40%.", "Sales promised a feature that doesn't exist. Again."],
};

export interface IdentityChange {
  name: string;
  product: string;
  distance: number; // 0..100, how far from the old product
}

/** Pivot and/or rebrand. Returns a log line, or "" if nothing changed. */
export function changeIdentity(s: GameState, c?: IdentityChange) {
  if (!c) return "";
  const name = c.name && c.name !== s.company ? c.name : "";
  const product = c.product && c.product.toLowerCase() !== s.product.toLowerCase() ? c.product : "";
  if (!name && !product) return "";
  s.formerly.unshift(`${s.company} (${s.product})`);
  s.formerly.length = Math.min(s.formerly.length, 6);
  const parts: string[] = [];
  if (name) {
    parts.push(`${s.company} is now ${name}`);
    s.company = name;
  }
  if (product) {
    parts.push(`the product is now: ${product.replace(/^(a|an)\s/i, "")}`);
    s.product = product.replace(/^(a|an)\s/i, "");
    // the further the pivot, the more of the product and sales pipeline is suddenly useless
    damageSystems(s, Math.min(35, 5 + Math.round(c.distance * 0.3)), ["product"]);
    damageSystems(s, Math.min(25, Math.round(c.distance * 0.2)), ["sales"]);
  }
  const line = parts.join(", and ");
  rememberAll(s, `Found out ${line}.`);
  log(s, `🔀 ${line[0].toUpperCase()}${line.slice(1)}. ${product ? "Engineering found out from TechCrunch." : "Marketing ordered new hoodies."}`);
  return line;
}

// ---------- genesis ----------

export interface Genesis {
  company: string;
  product: string;
  founding_story: string;
  employees: { name: string; role: string; quirk: string }[];
}

/** Reskin a freshly created company with LLM-made identity and people. Numbers stay engine-made. */
export function applyGenesis(s: GameState, g: Genesis) {
  const placeholder = s.company;
  if (g.company) s.company = g.company;
  if (g.product) s.product = g.product;
  if (g.founding_story) s.founding = g.founding_story;
  g.employees.slice(0, s.employees.length).forEach((x, i) => {
    const e = s.employees[i];
    e.name = x.name;
    if (ROLES.includes(x.role)) e.role = x.role;
    e.quirk = x.quirk;
    e.history = [];
    e.salary = 38_000 + Math.round(Math.random() * 14) * 1_000;
  });
  // ownership follows the new roles
  for (const k of SYSTEM_IDS) s.systems[k].owner = null;
  assignOwners(s);
  s.genesisDone = true;
  s.log = s.log.filter((l) => !l.includes(placeholder)); // drop lines about the placeholder company
  log(s, s.career > 1 ? `You land a new CEO gig at ${s.company}. Nobody checked your references.` : `Welcome, CEO of ${s.company} Product: ${s.product}.`);
}

// ---------- storylines ----------

/** Which storyline (if any) this quarter's event should continue. */
export function nextEpisodeFor(s: GameState): Thread | null {
  const open = s.threads.filter((t) => t.open && t.lastQuarter < s.quarter);
  if (!open.length || Math.random() > 0.55) return null;
  return open.sort((a, b) => a.lastQuarter - b.lastQuarter)[0];
}

/** Record what happened in an event that belongs to a storyline. Returns the thread and episode number. */
export function recordEpisode(s: GameState, title: string, summary: string, ends: boolean) {
  if (!title) return null;
  let t = s.threads.find((x) => x.open && x.title.toLowerCase() === title.toLowerCase());
  if (!t) {
    if (s.threads.filter((x) => x.open).length >= MAX_OPEN_THREADS) return null;
    t = { title, episodes: [], lastQuarter: s.quarter, open: true };
    s.threads.push(t);
  }
  t.episodes.push(`Q${s.quarter}: ${summary}`);
  t.lastQuarter = s.quarter;
  if (ends || t.episodes.length >= MAX_EPISODES) {
    t.open = false;
    log(s, `📖 Storyline closed: "${t.title}" (${t.episodes.length} episodes).`);
  }
  return { thread: t, episode: t.episodes.length };
}

/** Hit one or all systems (pivots, layoffs...). */
export function damageSystems(s: GameState, amount: number, only?: SystemId[]) {
  for (const k of only ?? SYSTEM_IDS) s.systems[k].health = clamp(s.systems[k].health - amount);
}

/**
 * Systems decay every quarter (entropy, incidents, load) and their owner fights back depending
 * on mood and how many systems they're juggling. Orphaned ones rot. Crossing 30 is a crisis.
 */
function stepSystems(s: GameState, lines: string[]) {
  const changes: string[] = [];
  for (const k of SYSTEM_IDS) {
    const sys = s.systems[k];
    const before = sys.health;
    const owner = s.employees.find((e) => e.id === sys.owner);
    if (!owner) sys.owner = null;
    let delta = -7; // entropy: everything gets worse if nobody tends it
    if (k === "infra" && s.employees.length > 15) delta -= 3; // scale
    if ((k === "infra" || k === "product") && hotDeskers(s) > 0) delta -= 2; // nobody can focus on a beanbag
    if (Math.random() < 0.15) {
      const hit = 8 + Math.floor(Math.random() * 11);
      delta -= hit;
      lines.push(`${SYSTEMS[k].emoji} Incident: ${pick(INCIDENTS[k])} (−${hit})`);
    }
    if (owner) {
      const juggling = ownedBy(s, owner.id).length;
      let care = owner.contractor ? 15 : Math.max(2, 4 + Math.round((employeeMood(s, owner) - 30) / 6));
      if (reportsOf(s, owner.id).length >= 3) care = Math.round(care / 2); // the Peter principle: now in meetings all day
      delta += Math.round(care / Math.max(1, juggling * 0.75));
      sys.health = clamp(sys.health + delta);
    } else {
      sys.health = clamp(sys.health + delta - 8);
      sys.health = clamp(sys.health - 15);
      // someone may reluctantly adopt it (with a learning curve)
      const free = s.employees.filter((e) => !ownedBy(s, e.id).length && SYSTEMS[k].roles.includes(e.role));
      if (free.length && Math.random() < 0.35) {
        const e = pick(free);
        makeOwner(s, k, e);
        sys.health = clamp(sys.health - 5);
        lines.push(`${e.name} reluctantly adopted ${SYSTEMS[k].name.toLowerCase()} after reading a 2019 README.`);
      } else lines.push(`${SYSTEMS[k].emoji} ${SYSTEMS[k].name}: nobody understands it anymore.`);
    }
    const d = sys.health - before;
    changes.push(`${SYSTEMS[k].emoji} ${SYSTEMS[k].name} ${sys.health} (${d >= 0 ? "+" : "−"}${Math.abs(d)})`);
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
  lines.push(`Systems: ${changes.join(" · ")}`);
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
export const IPO_MIN_QUARTER = 8;
/** Public markets want a path to profitability, not just hype. */
export const ipoProfitable = (s: GameState) => quarterlyRevenue(s) >= quarterlyCosts(s) * 0.8;

export function canIPO(s: GameState) {
  return s.quarter >= IPO_MIN_QUARTER && valuation(s) >= IPO_VALUATION && s.cash > 0 && ipoProfitable(s);
}

/** What's still missing for an IPO, for the UI. */
export type Sweetener = "none" | "board" | "prefs" | "guarantee";

export const SWEETENERS: Record<Sweetener, { label: string; blurb: string }> = {
  none: { label: "Standard terms", blurb: "Just money for shares." },
  board: { label: "Board seat", blurb: "A partner from the fund joins your board. Forever." },
  prefs: { label: "2x liquidation preference", blurb: "On exit they get twice their money back before you see a cent." },
  guarantee: { label: "Personal guarantee", blurb: "If the company dies, you personally repay half the round." },
};

const FUND_PARTNERS = ["Blake Whitfield", "Sloane Mercer", "Dev Kapoor", "Margot Lindqvist", "Tucker Hale", "Ines Okafor"];

/** The money side of a closed round. Returns a line describing what you signed. */
export function closeRound(s: GameState, amount: number, premoney: number, fair: number, sweetener: Sweetener): string {
  s.cash += amount;
  s.equity *= premoney / (premoney + amount);
  log(s, `Raised ${fmt(amount)} at a ${fmt(premoney)} pre-money valuation.`);
  // investors who paid a fantasy price expect the fantasy to come true
  if (premoney > fair * 1.4 && !s.kpis.some((k) => k.metric === "valuation"))
    addKpi(s, `Grow into the ${fmt(premoney)} valuation`, "valuation", premoney / fair, 4);
  if (sweetener === "prefs") {
    s.liquidationPref += amount * 2;
    return `They get ${fmt(amount * 2)} off the top of any exit.`;
  }
  if (sweetener === "guarantee") {
    s.guarantee += Math.round(amount / 2);
    return `You personally guaranteed ${fmt(Math.round(amount / 2))}. Your apartment is now part of the cap table.`;
  }
  if (sweetener === "board") {
    const name = FUND_PARTNERS.find((n) => !s.cast.some((c) => c.name === n)) ?? "Another partner";
    s.cast.push({ name, role: `partner at the fund that led your round, now sits on your board of ${s.company} and has opinions about everything`, history: [] });
    log(s, `${name} joins the board.`);
    return `${name} joins your board. Their first email has 14 bullet points.`;
  }
  return "";
}

export function ipoBlocker(s: GameState) {
  if (s.quarter < IPO_MIN_QUARTER) return `Q${IPO_MIN_QUARTER}+`;
  if (valuation(s) < IPO_VALUATION) return `valuation ${fmt(IPO_VALUATION)}`;
  if (!ipoProfitable(s)) return "path to profit";
  return null;
}

export function ipo(s: GameState) {
  // lock-up period, taxes and the bankers' cut: you see about 60% of the paper value
  const pref = Math.min(valuation(s), s.liquidationPref);
  const payout = Math.round((valuation(s) - pref) * s.equity * 0.6);
  s.savings += payout;
  s.reputation = clamp(s.reputation + 20);
  s.over = {
    win: netWorth(s) >= FIRE_TARGET,
    canContinue: netWorth(s) < FIRE_TARGET,
    title: "IPO! The bell has been rung",
    text: `${s.company} went public at ${fmt(valuation(s))}. After lock-up, taxes and the bankers, your ${(s.equity * 100).toFixed(1)}% stake nets you ${fmt(payout)}.${pref ? ` (The liquidation preference you signed took ${fmt(pref)} off the top first.)` : ""}${netWorth(s) >= FIRE_TARGET ? " FIRE achieved - you never open Slack again." : " Not enough for FIRE yet... time for another company."}`,
  };
}
