// Deterministic simulation core. The LLM only proposes deltas; this module applies
// and clamps them, runs the quarterly economy and decides win/lose conditions.

export const FIRE_TARGET = 5_000_000;
export const MAX_DESKS = 14;
export const ACTIONS_PER_QUARTER = 2;

const SALARY_PER_QUARTER = 45_000;
const REVENUE_PER_EMPLOYEE = 34_000;
const OFFICE_COST = 60_000;
const CEO_PAY = 90_000;
const LICENSE_COST = 1_500;

export interface Employee {
  id: number;
  name: string;
  role: string;
  quirk: string;
  moodOffset: number;
  desk: number;
  talkedQuarter: number;
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
  employees: Employee[];
  promises: PromiseItem[];
  actionsLeft: number;
  lastPartyQuarter: number;
  lastRaiseQuarter: number;
  lastRevenue: number;
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

function makeEmployee(desk: number, quarter: number): Employee {
  return {
    id: nextId++,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    role: pick(ROLES),
    quirk: pick(QUIRKS),
    moodOffset: Math.round(Math.random() * 30 - 15),
    desk,
    talkedQuarter: quarter - 1,
  };
}

export function newCompany(prev?: GameState): GameState {
  const s: GameState = {
    company: `${pick(PREFIX)}${pick(SUFFIX)} Inc.`,
    product: pick(PRODUCTS),
    career: (prev?.career ?? 0) + 1,
    quarter: 1,
    cash: 3_000_000,
    morale: 60,
    hype: 50,
    suspicion: prev ? Math.round(prev.suspicion / 3) : 0,
    reputation: prev?.reputation ?? 60,
    savings: prev?.savings ?? 200_000,
    offshore: prev?.offshore ?? 0,
    equity: 0.1,
    employees: [],
    promises: [],
    actionsLeft: ACTIONS_PER_QUARTER,
    lastPartyQuarter: -10,
    lastRaiseQuarter: -10,
    lastRevenue: 0,
    recentEvents: [],
    log: [],
  };
  for (let i = 0; i < 10; i++) s.employees.push(makeEmployee(i, 1));
  log(s, prev ? `You land a new CEO gig at ${s.company}. Nobody checked your references.` : `Welcome, CEO of ${s.company} You make a ${s.product}.`);
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

export function quarterlyRevenue(s: GameState) {
  return Math.round(s.employees.length * REVENUE_PER_EMPLOYEE * (0.4 + s.morale / 100));
}

export function quarterlyCosts(s: GameState) {
  const n = s.employees.length;
  return n * SALARY_PER_QUARTER + OFFICE_COST + CEO_PAY + Math.max(0, n - 1) * LICENSE_COST;
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
  const used = new Set(s.employees.map((e) => e.desk));
  let hired = 0;
  for (let d = 0; d < MAX_DESKS && hired < count; d++) {
    if (!used.has(d)) {
      s.employees.push(makeEmployee(d, s.quarter));
      hired++;
    }
  }
  return hired;
}

export function removeEmployees(s: GameState, count: number): Employee[] {
  const gone: Employee[] = [];
  for (let i = 0; i < count && s.employees.length > 0; i++) {
    const idx = Math.floor(Math.random() * s.employees.length);
    gone.push(...s.employees.splice(idx, 1));
  }
  return gone;
}

export function applyEffects(s: GameState, e: Effects): { hired: number; gone: Employee[] } {
  s.morale = clamp(s.morale + (e.morale ?? 0));
  s.hype = clamp(s.hype + (e.hype ?? 0));
  s.suspicion = clamp(s.suspicion + (e.suspicion ?? 0));
  s.cash += e.cash ?? 0;
  s.offshore += Math.max(0, e.offshore ?? 0);
  const hc = e.headcount ?? 0;
  if (hc > 0) return { hired: hire(s, hc), gone: [] };
  if (hc < 0) return { hired: 0, gone: removeEmployees(s, -hc) };
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
    s.promises.length ? `Open CEO promises: ${s.promises.map((p) => `"${p.text}" due Q${p.dueQuarter}`).join("; ")}.` : "No open promises.",
    `Recent log: ${s.log.slice(0, 4).join(" | ")}`,
  ].join("\n");
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
      lines.push(`You actually kept a promise: "${p.text}" (${fmt(p.cost)}). People are shocked.`);
    } else {
      s.morale = clamp(s.morale - 18);
      s.reputation = clamp(s.reputation - 4);
      lines.push(`Broken promise: "${p.text}". Someone printed your old email and taped it to the fridge.`);
    }
  }
  s.promises = s.promises.filter((p) => p.dueQuarter > s.quarter);

  // drift
  s.morale = clamp(s.morale - 3);
  s.hype = clamp(s.hype - 5 + (rev > cost ? 4 : 0));
  s.suspicion = clamp(s.suspicion - 4);

  // attrition
  if (s.morale < 25 && s.employees.length > 0) {
    const n = Math.max(1, Math.round(s.employees.length * (s.morale < 12 ? 0.4 : 0.15)));
    const quit = removeEmployees(s, n);
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

/** Honest exit: IPO pays out the CEO's equity. */
export function canIPO(s: GameState) {
  return s.quarter >= 6 && valuation(s) >= 60_000_000 && s.cash > 0;
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
