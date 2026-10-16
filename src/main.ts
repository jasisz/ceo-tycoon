import Phaser from "phaser";
import "./style.css";
import { OfficeScene } from "./scene/OfficeScene";
import { music } from "./audio/music";
import {
  ACTIONS_PER_QUARTER,
  FIRE_TARGET,
  IPO_VALUATION,
  PRODUCTS,
  applyEffects,
  canIPO,
  clearSave,
  loadGame,
  saveGame,
  describe,
  employeeMood,
  endQuarter,
  fmt,
  hire,
  ipo,
  log,
  netWorth,
  newCompany,
  quarterlyCosts,
  quarterlyRevenue,
  removeEmployees,
  runwayQuarters,
  valuation,
  capacity,
  maxHeadcount,
  hotDeskers,
  rent,
  office,
  buyUpgrade,
  closeRound,
  type SystemId,
  costBreakdown,
  hireCandidate,
  HIRE_PERKS,
  RECRUIT_FEE,
  type HirePerk,
  pick,
  SWEETENERS,
  type Sweetener,
  isOldNews,
  perkEffect,
  upkeepOf,
  upgradeBlocker,
  upgradeCost,
  moveBlocker,
  moveOffice,
  floorBlocker,
  leaseFloor,
  SYSTEMS,
  SYSTEM_IDS,
  KPI_LABEL,
  addKpi,
  noticeZug,
  ownedBy,
  payOf,
  rehire,
  rehireBlocker,
  remember,
  rememberAll,
  removeEmployee,
  damageSystems,
  changeIdentity,
  type IdentityChange,
  applyPeople,
  nextEpisodeFor,
  ipoBlocker,
  applyGenesis,
  ROLES,
  type Genesis,
  payZug,
  zugSuspicion,
  ZUG_SCHEMES,
  zugSchemeSuspicion,
  type ZugScheme,
  recordEpisode,
  MAX_EPISODES,
  MAX_OPEN_THREADS,
  type PersonEffect,
  type Alumnus,
  type Employee,
  type Effects,
  type GameState,
} from "./game/state";
import { applyReorg, CEO_SPAN, ceoSpan, delegates, HEALTHY_DEPTH, MANAGER_SPAN, managerOf, orgDepth, reportsOf, TITLE_IDS, TITLES, titleOf, wouldCycle, type OrgChange, type Title } from "./game/org";
import { BOARD_EVERY, boardMembers, enactMotion, pickMotion, rememberVote, tally } from "./game/board";
import { FLOOR_COST, FLOOR_DESKS, FLOOR_RENT, NOVELTY_QUARTERS, OFFICES, UPGRADES, type OfficeTier, type UpgradeSpec } from "./game/office";

// ---------- API ----------

interface Judgement {
  deltas: { morale: number; hype: number; suspicion: number };
  consequences: { cash: number; headcount: number };
  memory: string;
  accepted: boolean;
  people: PersonEffect[];
  company: IdentityChange;
  kpis: { quote: string; metric: "revenue" | "headcount" | "valuation" | "hype"; multiplier: number; quarters: number }[];
  votes?: { name: string; vote: "yes" | "no"; line: string }[];
  deal?: { verdict: "accept" | "counter" | "pass"; premoney: number; amount: number; line: string };
  narration: string;
  reactions: { speaker: string; line: string }[];
  promises: { text: string; quarters_until_due: number; cost: number }[];
  bullshit_score: number;
  mock: boolean;
}
interface GameEvent {
  storyline?: { title: string; ends: boolean };
  title: string;
  description: string;
  choices: { label: string; outcome: string; effects: Required<Effects>; people?: PersonEffect[]; company?: IdentityChange }[];
  mock: boolean;
}

let mockMode = false;

async function api<T extends { mock?: boolean }>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  mockMode = !!data.mock;
  return data;
}

// ---------- state ----------

const saved = loadGame();
let s: GameState = saved ?? newCompany();
let scene: OfficeScene;
let busy = false;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------- HUD ----------

function bar(label: string, value: number, cls: string, hint: string) {
  return `<div class="stat" title="${hint}"><span>${label}</span><div class="bar ${cls}"><i style="width:${value}%"></i></div><b>${value}</b></div>`;
}
function num(label: string, value: string, cls = "") {
  return `<div class="num ${cls}"><span>${label}</span><b>${value}</b></div>`;
}

function renderHud() {
  const runway = runwayQuarters(s);
  const fire = clamp((netWorth(s) / FIRE_TARGET) * 100, 0, 100);
  $("#hud").innerHTML = `
    <div class="brand"><b>${esc(s.company)}</b><small>${esc(s.product)} · Q${s.quarter} · company #${s.career}</small></div>
    <div class="bars">
      ${bar("Morale", s.morale, "morale", "How much employees can stand you")}
      ${bar("Investor hype", s.hype, "hype", "How good investors THINK things are")}
      ${bar("Suspicion", s.suspicion, "susp", "Board & auditors. 75+ during an audit = jail")}
    </div>
    <div class="nums">
      ${num("Cash", fmt(s.cash), s.cash < 500_000 ? "warn" : "")}
      ${num("Runway", runway === Infinity ? "∞" : `${runway.toFixed(1)}q`, runway < 3 ? "warn" : "")}
      ${num("Valuation", fmt(valuation(s)))}
      ${num("Staff / desks", `${s.employees.length}/${capacity(s) === Infinity ? "∞" : capacity(s)}`, hotDeskers(s) ? "warn" : "")}
      ${num("Office", `${office(s).emoji} ${office(s).name.split(" ")[0]}`)}
    </div>
    <div class="fire" title="Savings + offshore. Reach ${fmt(FIRE_TARGET)} to retire.">
      <span>FIRE ${fmt(netWorth(s))} / ${fmt(FIRE_TARGET)}</span>
      <div class="bar fireb"><i style="width:${fire}%"></i></div>
    </div>
    ${mockMode ? `<div class="mock" title="No API key found - game master is a dumb heuristic">MOCK GM</div>` : ""}
    <button id="mute" title="Corporate ukulele on/off">${music.muted ? "🔇" : "🔊"}</button>
  `;
}

function renderLog() {
  $("#log").innerHTML = `<h3>Company log</h3>` + s.log.map((l) => `<p>${esc(l)}</p>`).join("");
}

type Group = "talk" | "people" | "company" | "shady";

interface Action {
  id: string;
  group: Group;
  icon: string;
  label: string;
  hint: string;
  free?: boolean; // doesn't use up a decision
  enabled: () => boolean;
  /** Small caption under the label: cost, cooldown or why it's unavailable. */
  sub: () => string;
  run: () => Promise<void> | void;
}

const GROUPS: { id: Group; title: string }[] = [
  { id: "talk", title: "🗣️ Talk" },
  { id: "people", title: "👥 People" },
  { id: "company", title: "🏢 Company" },
  { id: "shady", title: "🕶️ Off the books" },
];

const cooldown = (since: number, every: number) => {
  const left = since + every - s.quarter;
  return left > 0 ? `in ${left}q` : "";
};

const ACTIONS: Action[] = [
  { id: "allhands", group: "talk", icon: "📣", label: "All-hands", hint: "Write a speech. The game master judges how it lands.", enabled: () => true, sub: () => "you write it", run: allHands },
  {
    id: "pitch",
    group: "talk",
    icon: "💼",
    label: "Pitch VCs",
    hint: "Raise money. Success depends on hype and your pitch. Every 2 quarters.",
    enabled: () => s.quarter - s.lastRaiseQuarter >= 2,
    sub: () => cooldown(s.lastRaiseQuarter, 2) || "raise money",
    run: pitch,
  },
  {
    id: "media",
    group: "talk",
    icon: "📰",
    label: "Media",
    hint: "A podcast, an interview, a LinkedIn post or a paid feature. Hype is cheap; quotes are forever. Once a quarter.",
    enabled: () => s.lastMediaQuarter < s.quarter,
    sub: () => (s.lastMediaQuarter >= s.quarter ? "next quarter" : "go public"),
    run: media,
  },
  {
    id: "hire",
    group: "people",
    icon: "🧑‍💻",
    label: "Agency +2",
    hint: "An agency sends two people you never meet. Recruiting fees $40k. Beyond your desk count, people hot-desk (morale penalty).",
    enabled: () => s.employees.length < maxHeadcount(s),
    sub: () => (s.employees.length >= maxHeadcount(s) ? "no room" : s.employees.length + 2 > capacity(s) ? "$40k · no desks!" : "$40k"),
    run: hireTwo,
  },
  {
    id: "recruit",
    group: "people",
    icon: "🤝",
    label: "Interview",
    hint: `Meet three candidates, make one an offer. ${fmt(RECRUIT_FEE)} recruiter fee whether they sign or not. They've read your Glassdoor.`,
    enabled: () => s.employees.length < maxHeadcount(s) && s.cash > RECRUIT_FEE,
    sub: () => (s.employees.length >= maxHeadcount(s) ? "no room" : `${fmt(RECRUIT_FEE)} fee`),
    run: recruit,
  },
  {
    id: "layoff",
    group: "people",
    icon: "✂️",
    label: "Lay off 10%",
    hint: "Investors: efficiency! Employees: fear.",
    enabled: () => s.employees.length > 1,
    sub: () => `−${Math.max(1, Math.round(s.employees.length * 0.1))} people`,
    run: layoffs,
  },
  {
    id: "party",
    group: "people",
    icon: "🎉",
    label: "Party",
    hint: "Once a year. $6k per head. Big morale boost.",
    enabled: () => s.quarter - s.lastPartyQuarter >= 4,
    sub: () => cooldown(s.lastPartyQuarter, 4) || fmt(6_000 * s.employees.length),
    run: party,
  },
  {
    id: "bonus",
    group: "people",
    icon: "💸",
    label: "Promise bonus",
    hint: "Morale now, bill in 2 quarters. Break it and morale crashes.",
    enabled: () => !s.promises.some((p) => p.text.startsWith("Bonus for everyone")),
    sub: () => (s.promises.some((p) => p.text.startsWith("Bonus for everyone")) ? "already promised" : `pay ${fmt(8_000 * s.employees.length)} later`),
    run: promiseBonus,
  },
  {
    id: "team",
    group: "people",
    icon: "👥",
    label: "Team",
    hint: "Everyone on payroll. Pick someone for a 1:1 (or to let go).",
    free: true,
    enabled: () => s.employees.length > 0,
    sub: () => `${s.employees.length} people`,
    run: team,
  },
  {
    id: "org",
    group: "people",
    icon: "🏛️",
    label: "Org chart",
    hint: `Who reports to whom, and what you call them. More than ${CEO_SPAN} direct reports eats one of your decisions every quarter. Announcing a reorg costs a decision.`,
    free: true,
    enabled: () => s.employees.length > 0,
    sub: () => `${ceoSpan(s)} report to you${ceoSpan(s) > CEO_SPAN ? " ⚠️" : ""}`,
    run: orgChart,
  },
  {
    id: "alumni",
    group: "people",
    icon: "📇",
    label: "Alumni",
    hint: "People who left. Rehire one as a contractor (uses a decision, if they agree).",
    free: true,
    enabled: () => true,
    sub: () => (s.alumni.length ? `${s.alumni.length} former · ${s.alumni.filter((a) => a.grudge >= 60 || a.blewWhistle).length} angry` : "nobody yet"),
    run: alumni,
  },
  { id: "pivot", group: "company", icon: "🔀", label: "Pivot", hint: "New product. Hype up, morale down, Product and Sales take a beating.", enabled: () => true, sub: () => "hype ↑ product ↓", run: pivot },
  { id: "realestate", group: "company", icon: "🏢", label: "Real estate", hint: "Move offices, lease another floor or go remote.", enabled: () => true, sub: () => `${office(s).emoji} ${office(s).name.split(" ")[0].toLowerCase()}`, run: realEstate },
  { id: "shop", group: "company", icon: "🛍️", label: "Office shop", hint: "Perks for the office. Costs money, not a decision.", free: true, enabled: () => true, sub: () => "free action", run: shop },
  { id: "ipo", group: "company", icon: "🔔", label: "IPO", hint: `Q8+, valuation ≥ ${fmt(IPO_VALUATION)} and revenue ≥ 80% of costs. You net ~60% of your stake after lock-up and taxes.`, enabled: () => canIPO(s), sub: () => (canIPO(s) ? "ring the bell!" : `needs ${ipoBlocker(s)}`), run: doIpo },
  {
    id: "offshore",
    group: "shady",
    icon: "🏝️",
    label: "Meet Herr Brunner",
    hint: "Move company money to your account in Zug. Pick a scheme, sell him the cover story. Each transfer is more suspicious than the last.",
    enabled: () => s.cash > ZUG_SCHEMES.retreat.amount,
    sub: () => `suspicion +${zugSuspicion(s)}ish · stash ${fmt(s.offshore)}`,
    run: offshore,
  },
];

function renderActions() {
  const left = s.actionsLeft;
  const pips = Array.from({ length: Math.max(ACTIONS_PER_QUARTER, left) }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("");
  $("#actions").innerHTML = GROUPS.map((g) => {
    const items = ACTIONS.filter((a) => a.group === g.id);
    return `<section class="group ${g.id}">
      <h4>${g.title}</h4>
      <div class="grid">${items
        .map((a) => {
          const off = busy || (left <= 0 && !a.free) || !a.enabled();
          return `<button data-a="${a.id}" title="${esc(a.hint)}" class="${a.free ? "free" : ""} ${a.id === "ipo" && !off ? "glow" : ""}" ${off ? "disabled" : ""}>
            <span class="ic">${a.icon}</span><span class="lb">${esc(a.label)}</span><small>${esc(a.sub())}</small>
          </button>`;
        })
        .join("")}</div>
    </section>`;
  }).join("");
  $("#footer").innerHTML = `
    <div class="decisions" title="Decisions left this quarter. The office shop and 1:1s are free.">
      <span>Decisions</span><span class="pips">${pips}</span>
    </div>
    <p class="tip">💡 Click employees for a free 1:1. Click yourself 🕶️ for finances.</p>
    <button class="end" data-a="end" ${busy ? "disabled" : ""}>End Q${s.quarter} ▶</button>`;
}

function renderSystems() {
  $("#systems").innerHTML =
    `<h3>Company systems</h3>` +
    SYSTEM_IDS.map((k) => {
      const sys = s.systems[k];
      const o = s.employees.find((e) => e.id === sys.owner);
      const cls = sys.health < 30 ? "crit" : sys.health < 50 ? "warn" : "";
      return `<div class="sys ${cls}" title="${esc(o ? `Only ${o.name} understands this.` : "Nobody understands this anymore. It's rotting.")}">
        <span>${SYSTEMS[k].emoji} ${SYSTEMS[k].name}</span>
        <div class="bar"><i style="width:${sys.health}%"></i></div>
        <small>${o ? esc(o.name.split(" ")[0]) : "⚠️ nobody"}</small>
      </div>`;
    }).join("");
}

function render() {
  saveGame(s);
  music.update({ morale: s.morale, suspicion: s.suspicion, crisis: s.crises.length > 0, office: s.office });
  renderSystems();
  renderHud();
  renderActions();
  renderLog();
  scene?.setView({ tier: s.office, floors: s.floors, upgrades: s.upgrades, headcount: s.employees.length });
  scene?.sync(s.employees);
  scene?.setOffshore(s.offshore);
}

$("#panel").addEventListener("click", async (e) => {
  const id = (e.target as HTMLElement).closest("button")?.dataset.a;
  if (!id || busy) return;
  if (id === "end") return nextQuarter();
  const a = ACTIONS.find((x) => x.id === id);
  if (!a || !a.enabled() || (s.actionsLeft <= 0 && !a.free)) return;
  await a.run();
  render();
});

// ---------- modal ----------

interface Btn {
  label: string;
  value: string;
  primary?: boolean;
}

function modal(html: string, buttons: Btn[], opts: { input?: string; wide?: boolean } = {}): Promise<{ value: string; text: string }> {
  const m = $("#modal");
  const card = $("#modal-card");
  card.classList.toggle("wide", !!opts.wide);
  card.innerHTML = `${html}
    ${opts.input !== undefined ? `<textarea id="m-input" rows="5" placeholder="${esc(opts.input)}"></textarea>` : ""}
    <div class="btns">${buttons.map((b, i) => `<button data-i="${i}" class="${b.primary ? "primary" : ""}">${esc(b.label)}</button>`).join("")}</div>`;
  m.classList.remove("hidden");
  const ta = card.querySelector("textarea");
  ta?.focus();
  return new Promise((resolve) => {
    // buttons inside the body (e.g. event choices) resolve with their data-v value
    card.querySelectorAll<HTMLButtonElement>("[data-v]").forEach((btn) =>
      btn.addEventListener("click", () => {
        m.classList.add("hidden");
        resolve({ value: btn.dataset.v!, text: "" });
      }),
    );
    card.querySelectorAll<HTMLButtonElement>(".btns button").forEach((btn) =>
      btn.addEventListener("click", () => {
        const b = buttons[Number(btn.dataset.i)];
        const text = ta?.value.trim() ?? "";
        if (b.primary && ta && !text) return ta.focus();
        m.classList.add("hidden");
        resolve({ value: b.value, text });
      }),
    );
  });
}

function loading(text: string) {
  $("#modal-card").innerHTML = `<div class="loading"><div class="spinner"></div><p>${esc(text)}</p></div>`;
  $("#modal").classList.remove("hidden");
}
function modalOpen() {
  return !$("#modal").classList.contains("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
}

function deltaChips(d: Partial<Record<string, number>>) {
  const names: Record<string, string> = { morale: "Morale", hype: "Hype", suspicion: "Suspicion", cash: "Cash", offshore: "Offshore", headcount: "Staff" };
  return Object.entries(d)
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const good = k === "suspicion" ? v! < 0 : v! > 0;
      const val = k === "cash" || k === "offshore" ? fmt(v!) : `${v! > 0 ? "+" : ""}${v}`;
      return `<span class="chip ${good ? "good" : "bad"}">${names[k] ?? k} ${k === "cash" || k === "offshore" ? (v! > 0 ? "+" : "") : ""}${val}</span>`;
    })
    .join("");
}

// ---------- LLM-driven helpers ----------

function speakerToEmployee(name: string) {
  const exact = s.employees.find((e) => name.toLowerCase().includes(e.name.split(" ")[0].toLowerCase()));
  return exact ?? s.employees[Math.floor(Math.random() * s.employees.length)];
}

function showReactions(j: Judgement, onlyFor?: number) {
  j.reactions.forEach((r, i) => {
    const e = onlyFor !== undefined ? s.employees.find((x) => x.id === onlyFor) : speakerToEmployee(r.speaker);
    if (e) setTimeout(() => scene.bubble(e.id, r.line), 600 + i * 1400);
  });
}

function addPromises(j: Judgement, to?: Employee) {
  for (const p of j.promises) {
    const due = s.quarter + clamp(p.quarters_until_due, 1, 4);
    s.promises.push({ text: to ? `${p.text} (to ${to.name})` : p.text, dueQuarter: due, cost: clamp(p.cost, 0, 2_000_000) });
    if (to) remember(to, s.quarter, `CEO promised me: "${p.text}" by Q${due}.`);
    else rememberAll(s, `CEO promised everyone: "${p.text}" by Q${due}.`);
    log(s, `You promised${to ? ` ${to.name}` : ""}: "${p.text}". Someone wrote it down.`);
  }
}

const npcOf = (e: Employee) => ({
  name: e.name,
  role: e.role,
  quirk: e.quirk,
  mood: employeeMood(s, e),
  history: e.history,
  owns: ownedBy(s, e.id).map((k) => SYSTEMS[k].name.toLowerCase()),
});

async function judged(scene_: string, text: string, extra: Record<string, unknown> = {}) {
  return api<Judgement>("/api/judge", { scene: scene_, text, context: describe(s), ...extra });
}

function peopleHtml(lines: string[]) {
  return lines.length ? `<div class="memories"><b>Who's affected:</b>${lines.map((l) => `<p>👤 ${esc(l)}</p>`).join("")}</div>` : "";
}

function judgementHtml(title: string, j: Judgement, extra = "", deltas: Partial<Record<string, number>> = j.deltas) {
  const touched = j.people?.length ? applyPeople(s, j.people) : [];
  const identity = changeIdentity(s, j.company);
  j.company = { name: "", product: "", distance: 0 }; // applied
  return `<h2>${esc(title)}</h2>
    <p class="narr">${esc(j.narration)}</p>${identity ? `<p class="big">🔀 ${esc(identity[0].toUpperCase() + identity.slice(1))}.</p>` : ""}${peopleHtml(touched)}
    ${j.reactions.map((r) => `<p class="quote"><b>${esc(r.speaker)}:</b> “${esc(r.line)}”</p>`).join("")}
    ${extra}
    <div class="chips">${deltaChips(deltas)}<span class="chip neutral">BS-meter ${j.bullshit_score}%</span></div>
    ${j.promises.length ? `<p class="promise">📝 Remembered promise: ${j.promises.map((p) => esc(p.text)).join(", ")}</p>` : ""}`;
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  busy = true;
  renderActions();
  try {
    return await fn();
  } catch (err) {
    closeModal();
    await modal(`<h2>The game master spilled coffee</h2><p>${esc(String(err))}</p>`, [{ label: "OK", value: "ok" }]);
    return undefined;
  } finally {
    busy = false;
    render();
  }
}

// ---------- actions ----------

async function allHands() {
  const r = await modal(
    `<h2>📣 All-hands</h2><p>The whole company is gathering in the meeting room. ${s.employees.length} people, ${s.morale < 40 ? "arms crossed" : "mildly curious"}. What do you say?</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "Deliver speech", value: "go", primary: true },
    ],
    { input: "Team, I have some exciting news about our AI-first journey..." },
  );
  if (r.value !== "go") return;
  await withBusy(async () => {
    scene.gather();
    scene.ceoBubble(r.text.slice(0, 90) + (r.text.length > 90 ? "…" : ""));
    loading("The team is processing your words...");
    const j = await judged("allhands", r.text);
    applyEffects(s, j.deltas);
    addPromises(j);
    s.actionsLeft--;
    log(s, `All-hands: ${j.narration}`);
    showReactions(j);
    await modal(judgementHtml("All-hands aftermath", j), [{ label: "Back to work", value: "ok" }]);
  });
}

const ASKS = [
  { label: "Small bridge", frac: 0.1 },
  { label: "Proper round", frac: 0.2 },
  { label: "Mega-round", frac: 0.35 },
];
const VALUATIONS = [
  { label: "Fair", mult: 1 },
  { label: "Optimistic", mult: 1.6 },
  { label: "Delusional", mult: 3 },
];

async function pitch() {
  const fair = valuation(s);
  const round = (n: number) => Math.max(50_000, Math.round(n / 50_000) * 50_000);
  const select = (id: string, opts: string[], def = 0) =>
    `<select id="${id}">${opts.map((o, i) => `<option value="${i}" ${i === def ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const promise = modal(
    `<h2>💼 Investor pitch</h2><p>Valuation ${fmt(fair)}, revenue ${fmt(quarterlyRevenue(s))}/q, burn ${fmt(Math.max(0, quarterlyCosts(s) - quarterlyRevenue(s)))}/q. Three partners from a VC fund stare at you over oat-milk lattes.</p>
    <div class="terms">
      <label>Ask ${select("p-ask", ASKS.map((a) => `${a.label}: ${fmt(round(fair * a.frac))}`), 1)}</label>
      <label>Valuation ${select("p-val", VALUATIONS.map((v) => `${v.label}: ${fmt(round(fair * v.mult))}`))}</label>
      <label>Terms ${select("p-sweet", Object.values(SWEETENERS).map((w) => w.label))}</label>
    </div>
    <p class="sub" id="p-sum"></p>
    <p>Pitch.</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "Pitch", value: "go", primary: true },
    ],
    { input: "We're not a SaaS, we're a platform. Think Uber, but for..." },
  );
  const readTerms = () => {
    const ask = round(fair * ASKS[Number(($("#p-ask") as HTMLSelectElement).value)].frac);
    const premoney = round(fair * VALUATIONS[Number(($("#p-val") as HTMLSelectElement).value)].mult);
    const sweetener = Object.keys(SWEETENERS)[Number(($("#p-sweet") as HTMLSelectElement).value)] as Sweetener;
    return { ask, premoney, fair, sweetener };
  };
  const summarize = () => {
    const p = readTerms();
    $("#p-sum").textContent = `If they say yes: +${fmt(p.ask)}, your stake ${(s.equity * 100).toFixed(1)}% → ${((s.equity * p.premoney) / (p.premoney + p.ask) * 100).toFixed(1)}%. ${SWEETENERS[p.sweetener].blurb}`;
  };
  document.querySelectorAll(".terms select").forEach((el) => el.addEventListener("change", summarize));
  summarize();
  const terms = readTerms();
  const r = await promise;
  if (r.value !== "go") return;
  Object.assign(terms, readTerms());
  await withBusy(async () => {
    const arrived = scene.investorsArrive();
    loading("Investors are nodding thoughtfully...");
    const [j] = await Promise.all([judged("investors", r.text, { terms }), arrived]);
    applyEffects(s, j.deltas);
    addPromises(j);
    for (const k of j.kpis) addKpi(s, k.quote, k.metric, k.multiplier, k.quarters);
    const kpiHtml = s.kpis.length
      ? `<p class="promise">📝 Investors wrote down: ${j.kpis.map((k) => `“${esc(k.quote)}”`).join(", ") || "nothing new"}. They will check.</p>`
      : "";
    s.actionsLeft--;
    s.lastRaiseQuarter = s.quarter;
    const deal = j.deal ?? { verdict: "pass" as const, premoney: 0, amount: 0, line: "" };
    const said = deal.line ? `<p class="quote"><b>Lead partner:</b> “${esc(deal.line)}”</p>` : "";
    let extra: string;
    if (deal.verdict === "pass") {
      extra = `${said}<p class="big bad">🚪 "We'll circle back." They will not circle back.</p>`;
      log(s, "Investors passed.");
      scene.investorsLeave(false);
    } else {
      let take = deal.verdict === "accept";
      if (!take) {
        const keep = ((s.equity * deal.premoney) / (deal.premoney + deal.amount)) * 100;
        const c = await modal(
          `<h2>🧾 Counter-offer</h2>${said}<p>They offer <b>${fmt(deal.amount)}</b> at a <b>${fmt(deal.premoney)}</b> pre-money valuation (you asked ${fmt(terms.ask)} at ${fmt(terms.premoney)}). Your stake would drop to ${keep.toFixed(1)}%. ${esc(SWEETENERS[terms.sweetener].blurb)}</p>`,
          [
            { label: "Walk away", value: "no" },
            { label: "Take the money", value: "yes", primary: true },
          ],
        );
        take = c.value === "yes";
        if (!take) {
          s.hype = Math.max(0, s.hype - 3);
          log(s, `Walked away from a ${fmt(deal.amount)} counter-offer.`);
        }
      }
      if (take) {
        const signed = closeRound(s, deal.amount, deal.premoney, terms.fair, terms.sweetener);
        extra = `${deal.verdict === "accept" ? said : ""}<p class="big good">💰 Raised ${fmt(deal.amount)}! Your equity is diluted to ${(s.equity * 100).toFixed(1)}%.</p>${signed ? `<p class="promise">✍️ ${esc(signed)}</p>` : ""}`;
        scene.investorsLeave(true);
      } else {
        extra = `<p class="big bad">🚶 You walked out. Somewhere a partner tweets about "founder ego".</p>`;
        scene.investorsLeave(false);
      }
    }
    await modal(judgementHtml("Pitch result", j, extra + kpiHtml), [{ label: "OK", value: "ok" }]);
  });
}

const SPONSORED_COST = 40_000;

/** What Priya asks depends on what she has heard. */
function journalistQuestion() {
  const grudge = s.alumni.filter((a) => a.grudge > 60)[0];
  if (s.suspicion >= 40) return "Sources tell me there are regular \"consulting fees\" going to a firm in Zug. Who exactly is the consultant?";
  if (s.crises.length) return `Customers say ${SYSTEMS[s.crises[0]].name.toLowerCase()} has been broken for weeks. What is actually going on?`;
  if (grudge) return `${grudge.name}, who was ${grudge.reason} in Q${grudge.leftQuarter}, told me some things about how you run this company. Do you want to respond?`;
  if (s.kpis.length) return `You told investors: "${s.kpis[0].quote}". Are you on track, honestly?`;
  if (quarterlyRevenue(s) < quarterlyCosts(s)) return `You burn ${fmt(quarterlyCosts(s) - quarterlyRevenue(s))} a quarter. What's the path to profitability?`;
  return "What do you say to people who call this a solution looking for a problem?";
}

async function media() {
  const priya = s.cast.find((c) => /journalist/i.test(c.role));
  const outlets = [
    {
      id: "podcast",
      icon: "🎙️",
      name: "The Grindset Hour podcast",
      brief: "a three-hour founder podcast with a huge audience of aspiring founders; the host loves hustle, cold plunges and hot takes",
      question: pick(["Walk me through your morning routine. Be honest, what time do you wake up?", "What's the hardest decision you've made as a CEO?", "Is work-life balance a myth?", "If you had to fire half your team tomorrow, how would you decide?"]),
      cost: 0,
      blurb: "Huge reach, softball questions, the clip will outlive you.",
    },
    {
      id: "interview",
      icon: "📰",
      name: `${priya?.name ?? "A journalist"}, TechCrunchy`,
      brief: `${priya ? `${priya.role}. ` : ""}a sharp tech journalist doing a profile; she fact-checks and has sources inside the company`,
      question: journalistQuestion(),
      cost: 0,
      blurb: "Credibility if you're straight with her. She already has a question.",
    },
    {
      id: "linkedin",
      icon: "💼",
      name: "LinkedIn",
      brief: "the CEO's own thought-leadership post; employees, investors and former employees all see it",
      question: "(Nobody asked. You're writing a post.)",
      cost: 0,
      blurb: "Investors like, employees screenshot, alumni comment.",
    },
    {
      id: "sponsored",
      icon: "💸",
      name: "Fortunate magazine, sponsored feature",
      brief: `a glossy "Visionary CEOs to Watch" feature the company paid ${fmt(SPONSORED_COST)} for, written by the magazine's branded-content team; it says "sponsored" in 6pt font`,
      question: "Tell our readers what makes you a visionary.",
      cost: SPONSORED_COST,
      blurb: `${fmt(SPONSORED_COST)} from the company budget. Flattering by contract.`,
    },
  ];
  const c = await modal(
    `<h2>📰 Media</h2><p class="sub">Pick where to show your face. Whatever you say, the team reads it too.</p>
    <div class="choices">${outlets
      .map(
        (o) => `<button class="choice" data-v="${o.id}" ${o.cost > s.cash ? "disabled" : ""}>
        <b>${o.icon} ${esc(o.name)}${o.cost ? ` <span class="price">${fmt(o.cost)}</span>` : ""}</b>
        <small>${esc(o.blurb)}</small></button>`,
      )
      .join("")}</div>`,
    [{ label: "Cancel", value: "cancel" }],
    { wide: true },
  );
  const o = outlets.find((x) => x.id === c.value);
  if (!o) return;
  const r = await modal(
    `<h2>${o.icon} ${esc(o.name)}</h2><p class="quote">“${esc(o.question)}”</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: o.id === "linkedin" ? "Post" : "Answer", value: "go", primary: true },
    ],
    { input: o.id === "linkedin" ? "I fired my best engineer today. Here's what it taught me about B2B sales 🧵" : "Look, I'll be honest with you..." },
  );
  if (r.value !== "go") return;
  await withBusy(async () => {
    loading(o.id === "linkedin" ? "Waiting for likes..." : "The interview goes live...");
    const j = await judged("media", r.text, { outlet: { name: o.name, brief: o.brief, question: o.question } });
    if (o.cost) s.cash -= o.cost;
    applyEffects(s, j.deltas);
    addPromises(j);
    for (const k of j.kpis) addKpi(s, k.quote, k.metric, k.multiplier, k.quarters);
    s.actionsLeft--;
    s.lastMediaQuarter = s.quarter;
    log(s, `${o.name}: ${j.narration}`);
    showReactions(j);
    const kpiHtml = j.kpis.length ? `<p class="promise">📝 Investors clipped it: ${j.kpis.map((k) => `“${esc(k.quote)}”`).join(", ")}.</p>` : "";
    await modal(judgementHtml(`${o.icon} ${o.name}`, j, kpiHtml, o.cost ? { ...j.deltas, cash: -o.cost } : j.deltas), [{ label: "Close the tab", value: "ok" }]);
  });
}

interface Candidate {
  name: string;
  role: string;
  headline: string;
  strength: string;
  red_flag: string;
  quirk: string;
  heard: string;
  ask: number;
  mock?: boolean;
}

const OFFERS = [
  { label: "Lowball", mult: 0.8 },
  { label: "Their ask", mult: 1 },
  { label: "Generous", mult: 1.2 },
];

async function recruit() {
  const pool = await withBusy(async () => {
    loading("Your recruiter is forwarding LinkedIn profiles...");
    s.cash -= RECRUIT_FEE;
    s.actionsLeft--;
    return api<{ candidates: Candidate[]; mock?: boolean }>("/api/candidates", { context: describe(s), roles: ROLES });
  });
  if (!pool?.candidates.length) return;
  const cs = pool.candidates;
  const pickC = await modal(
    `<h2>🤝 Candidates</h2><p class="sub">${fmt(RECRUIT_FEE)} paid to the recruiter. Pick one to make an offer to, or let them all go.</p>
    <div class="choices">${cs
      .map(
        (c, i) => `<button class="choice" data-v="${i}">
        <b>${esc(c.name)} <span class="price">asks ${fmt(c.ask)}/q</span></b>
        <small>${esc(c.role)} · ${esc(c.headline)}</small>
        <small>✅ ${esc(c.strength)}</small>
        <small>🚩 ${esc(c.red_flag)}</small>
        <small>👂 Heard: ${esc(c.heard)}</small>
      </button>`,
      )
      .join("")}</div>`,
    [{ label: "Pass on all of them", value: "none" }],
    { wide: true },
  );
  const c = cs[Number(pickC.value)];
  if (!c) return log(s, "Interviewed three candidates and hired none of them. The recruiter still invoiced.");
  const select = (id: string, opts: string[], def = 0) =>
    `<select id="${id}">${opts.map((o, i) => `<option value="${i}" ${i === def ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const promise = modal(
    `<h2>📝 Offer for ${esc(c.name)}</h2>
    <p class="sub">${esc(c.role)} · asks ${fmt(c.ask)}/q · 🚩 ${esc(c.red_flag)}</p>
    <div class="terms">
      <label>Salary ${select("o-pay", OFFERS.map((o) => `${o.label}: ${fmt(Math.round((c.ask * o.mult) / 1000) * 1000)}/q`), 1)}</label>
      <label>Sweetener ${select("o-perk", Object.values(HIRE_PERKS).map((p) => p.label))}</label>
    </div>
    <p class="sub" id="o-sum"></p>
    <p>Why should they join?</p>`,
    [
      { label: "Withdraw", value: "cancel" },
      { label: "Make the offer", value: "go", primary: true },
    ],
    { input: `${c.name.split(" ")[0]}, I'll be straight with you about where we are...` },
  );
  const readOffer = () => {
    const o = OFFERS[Number(($("#o-pay") as HTMLSelectElement).value)];
    const perk = Object.keys(HIRE_PERKS)[Number(($("#o-perk") as HTMLSelectElement).value)] as HirePerk;
    return { label: o.label, salary: Math.round((c.ask * o.mult) / 1000) * 1000, perk };
  };
  const sum = () => {
    const o = readOffer();
    $("#o-sum").textContent = HIRE_PERKS[o.perk].blurb;
  };
  document.querySelectorAll(".terms select").forEach((el) => el.addEventListener("change", sum));
  sum();
  let offer = readOffer();
  const r = await promise;
  if (r.value !== "go") return log(s, `Withdrew the offer to ${c.name}. They'll tell people.`);
  offer = { ...offer, ...readOffer() };
  await withBusy(async () => {
    loading(`${c.name.split(" ")[0]} is checking your Glassdoor one more time...`);
    const words = `${offer.label.toLowerCase()}: ${fmt(offer.salary)} per quarter (they asked for ${fmt(c.ask)}), plus ${HIRE_PERKS[offer.perk].label.toLowerCase()}`;
    const j = await judged("recruit", r.text, {
      offer: words,
      npc: { name: c.name, role: c.role, quirk: `${c.quirk}. CV: ${c.headline}. Red flag: ${c.red_flag}. Has heard: ${c.heard}`, mood: 50 },
    });
    applyEffects(s, { morale: clamp(j.deltas.morale, -3, 3), hype: clamp(j.deltas.hype, -3, 3), suspicion: j.deltas.suspicion });
    let extra: string;
    if (j.accepted) {
      const e = hireCandidate(s, c, offer.salary, offer.perk, j.memory);
      addPromises(j, e);
      music.play("hire");
      log(s, `Hired ${c.name} (${c.role}) at ${fmt(offer.salary)}/q. ${j.narration}`);
      extra = `<p class="big good">🤝 ${esc(c.name)} signed. ${offer.perk === "title" ? "Team Lead from day one." : ""}</p>`;
    } else {
      log(s, `${c.name} turned down the offer. ${j.narration}`);
      extra = `<p class="big bad">📵 ${esc(c.name)} declined. They're telling the next company about your offer.</p>`;
    }
    render();
    await modal(judgementHtml(`Offer to ${c.name}`, j, extra), [{ label: "OK", value: "ok" }]);
  });
}

async function layoffs() {
  const n = Math.max(1, Math.round(s.employees.length * 0.1));
  const gone = removeEmployees(s, n, "laid off");
  damageSystems(s, 6); // fewer hands, same systems
  applyEffects(s, { morale: -15, hype: 6 });
  s.actionsLeft--;
  log(s, `Laid off ${gone.map((e) => e.name).join(", ")}. LinkedIn post: "Hardest decision of my life."`);
  render();
  scene.layoffShock();
  music.play("layoff");
  setTimeout(() => {
    const e = s.employees[0];
    if (e) scene.bubble(e.id, "Am I next?");
  }, 1500);
}

function hireTwo() {
  music.play("hire");
  s.cash -= 40_000;
  const n = hire(s, 2);
  applyEffects(s, { morale: 2 });
  s.actionsLeft--;
  log(s, `Hired ${n} people. They ask where the free snacks are.`);
  if (hotDeskers(s)) log(s, `${hotDeskers(s)} people have no desk. HR calls it "agile seating".`);
}

function party() {
  music.play("party");
  const cost = 6_000 * s.employees.length;
  s.cash -= cost;
  s.lastPartyQuarter = s.quarter;
  applyEffects(s, { morale: 16 });
  s.actionsLeft--;
  log(s, `Winter party for ${fmt(cost)}. Someone from Finance did karaoke. Morale restored.`);
  rememberAll(s, "Went to the winter party. The CEO gave a toast about 'family'.");
  scene.party();
}

function promiseBonus() {
  const cost = 8_000 * s.employees.length;
  s.promises.push({ text: "Bonus for everyone", dueQuarter: s.quarter + 2, cost });
  rememberAll(s, `CEO promised everyone a bonus, due Q${s.quarter + 2}.`);
  applyEffects(s, { morale: 10 });
  s.actionsLeft--;
  log(s, `You promised everyone a bonus (${fmt(cost)}, due Q${s.quarter + 2}).`);
  const e = s.employees[Math.floor(Math.random() * s.employees.length)];
  if (e) scene.bubble(e.id, "I'll believe it when I see it.");
}

async function pivot() {
  const ideas = PRODUCTS.filter((p) => p !== s.product);
  const surprise = ideas[Math.floor(Math.random() * ideas.length)];
  const r = await modal(
    `<h2>🔀 Pivot</h2>
    <p>Right now ${esc(s.company)}'s product is: <b>${esc(s.product)}</b>.${s.formerly.length ? ` <span class="sub">Formerly: ${s.formerly.slice(0, 2).map(esc).join("; ")}.</span>` : ""}</p>
    <p>What are we now? Rename the company too if you like. The further from today's product, the more of Product and Sales goes in the bin.</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "🎲 Surprise me", value: "surprise" },
      { label: "Announce pivot", value: "go", primary: true },
    ],
    { input: "We're no longer a kebab app. We are now 'Kebabify AI' — agentic infrastructure for the doner economy." },
  );
  if (r.value === "cancel") return;
  const text = r.value === "surprise" ? `We are pivoting. From now on we make a ${surprise}.` : r.text;
  await withBusy(async () => {
    loading("Updating the LinkedIn banner...");
    const j = await judged("pivot", text);
    if (!j.company.product && !j.company.name) j.company = { name: "", product: r.value === "surprise" ? surprise : text.slice(0, 70), distance: 60 };
    applyEffects(s, j.deltas);
    s.actionsLeft--;
    showReactions(j);
    music.play("pivot");
    await modal(judgementHtml("Pivot announced", j), [{ label: "Ship it", value: "ok" }]);
  });
}

async function offshore() {
  const r = await modal(
    `<p class="kicker">Zug, Switzerland</p><h2>🏦 Herr Brunner will see you now</h2>
    <p class="sub">Wood panelling. A clock that costs more than your Series A. He does not offer coffee. Stash so far: ${fmt(s.offshore)}.</p>
    <div class="choices">${(Object.keys(ZUG_SCHEMES) as ZugScheme[])
      .map((k) => {
        const z = ZUG_SCHEMES[k];
        return `<button class="choice" data-v="${k}" ${s.cash <= z.amount ? "disabled" : ""}>
        <b>${z.emoji} ${esc(z.label)} <span class="price">${fmt(z.amount)}</span></b>
        <small>${esc(z.blurb)}</small>
        <span>${chip(`You get ${fmt(z.amount * (1 - z.fee))}`, "good")}${chip(`Brunner ${Math.round(z.fee * 100)}%`, "neutral")}${chip(`Suspicion +${zugSchemeSuspicion(s, k)}`, "bad")}${s.cash <= z.amount ? chip("Can't afford", "neutral") : ""}</span>
      </button>`;
      })
      .join("")}</div>`,
    [{ label: "Leave quietly", value: "cancel" }],
    { wide: true },
  );
  const k = r.value as ZugScheme;
  const z = ZUG_SCHEMES[k];
  if (!z) return;
  const story = await modal(
    `<h2>${z.emoji} ${esc(z.label)}</h2><p class="quote"><b>Herr Brunner:</b> “${esc(z.brunner)} And when the auditors ask what this was for?”</p>`,
    [
      { label: "Leave quietly", value: "cancel" },
      { label: "Explain", value: "go", primary: true },
    ],
    { input: "It's a standard engagement. There's a deliverable. A deck, mostly..." },
  );
  if (story.value !== "go") return;
  await withBusy(async () => {
    loading("Herr Brunner is polishing his glasses...");
    const j = await judged("brunner", story.text, { eventTitle: `${z.label}: ${fmt(z.amount)} from company cash to the CEO's account, Brunner keeps ${Math.round(z.fee * 100)}%. This is transfer #${s.zugTransfers + 1} from ${s.company}.` });
    music.play("zug");
    const cover = clamp(j.deltas.suspicion, -5, 8);
    const susp = payZug(s, k, cover);
    s.actionsLeft--;
    log(s, `${z.label} (${fmt(z.amount)}) to Zug. Suspicion +${susp}. ${j.narration}`);
    scene.ceoBubble("Strategic. Very strategic.");
    scene.moneyFly();
    const extra = `<p class="big good">🏝️ ${fmt(z.amount * (1 - z.fee))} landed in Zug.</p><p class="sub">Cover story: ${cover < 0 ? "boring enough to work" : cover > 0 ? "memorable, which is bad" : "forgettable"} (${cover > 0 ? "+" : ""}${cover}).</p>`;
    await modal(judgementHtml("Zug", j, extra, { suspicion: susp }), [{ label: "Fly home", value: "ok" }]);
  });
}

async function doIpo() {
  music.play("ipo");
  ipo(s);
  render();
  await gameOver();
}

// ---------- real estate & office shop ----------

function chip(text: string, kind: "good" | "bad" | "neutral") {
  return `<span class="chip ${kind}">${esc(text)}</span>`;
}

function perQuarterChips(morale: number, hype: number, revenue = 0) {
  return [
    morale ? chip(`Morale ${morale > 0 ? "+" : ""}${morale}/q`, morale > 0 ? "good" : "bad") : "",
    hype ? chip(`Hype ${hype > 0 ? "+" : ""}${hype}/q`, hype > 0 ? "good" : "bad") : "",
    revenue ? chip(`Revenue ${revenue > 0 ? "+" : ""}${Math.round(revenue * 100)}%`, revenue > 0 ? "good" : "bad") : "",
  ].join("");
}

async function realEstate() {
  const here = office(s);
  const cap = capacity(s);
  const tiers: OfficeTier[] = ["garage", "cowork", "openspace", "campus", "remote"];
  const cards = tiers
    .map((t) => {
      const o = OFFICES[t];
      const block = moveBlocker(s, t);
      return `<button class="choice" data-v="move:${t}" ${block ? "disabled" : ""}>
        <b>${o.emoji} ${esc(o.name)}${t === s.office ? " (you are here)" : ""}</b>
        <small>${esc(o.blurb)}</small>
        <span>${chip(o.desks === Infinity ? "no desks" : `${o.desks} desks`, "neutral")}${chip(`rent ${fmt(o.rent)}/q`, "neutral")}${chip(`move ${fmt(o.moveCost)}`, "neutral")}${perQuarterChips(o.moralePerQ, o.hypePerQ)}${block && t !== s.office ? chip(block, "bad") : ""}</span>
      </button>`;
    })
    .join("");
  const fb = floorBlocker(s);
  const floor =
    s.office === "openspace"
      ? `<button class="choice" data-v="floor" ${fb ? "disabled" : ""}>
          <b>🏗️ Lease the east wing</b>
          <small>Knock through a wall. +${FLOOR_DESKS} desks, +${fmt(FLOOR_RENT)}/q rent, ${fmt(FLOOR_COST)} fit-out.</small>
          <span>${fb ? chip(fb, "bad") : chip("+5 hype", "good")}</span>
        </button>`
      : "";
  const r = await modal(
    `<h2>🏢 Real estate</h2>
    <p class="sub">Now: ${here.emoji} ${esc(here.name)} · ${cap === Infinity ? "no desks" : `${cap} desks`} for ${s.employees.length} people · rent ${fmt(rent(s))}/q.
    Moving uses a decision. Perks that don't fit the new place stay behind.</p>
    <div class="choices">${floor}${cards}</div>`,
    [{ label: "Stay put", value: "stay" }],
  );
  if (r.value === "floor" && !floorBlocker(s)) {
    leaseFloor(s);
  } else if (r.value.startsWith("move:")) {
    const t = r.value.slice(5) as OfficeTier;
    if (moveBlocker(s, t)) return;
    moveOffice(s, t);
  } else return;
  s.actionsLeft--;
  render();
  scene.sparkle();
}

function upgradeCard(u: UpgradeSpec) {
  const owned = s.upgrades.includes(u.id);
  const block = upgradeBlocker(s, u.id);
  const price = owned ? "✓ owned" : `${fmt(upgradeCost(s, u.id))}${u.perHead ? ` (${fmt(u.cost)}/head)` : ""}`;
  const stale = owned && isOldNews(s, u.id);
  const fx = owned ? perkEffect(s, u) : u;
  const upkeep = upkeepOf(s, u);
  return `<button class="choice" data-v="buy:${u.id}" ${block ? "disabled" : ""}>
    <b>${u.emoji} ${esc(u.name)} <span class="price">${price}</span></b>
    <small>${esc(u.blurb)}${stale ? " <i>Old news: nobody notices it anymore.</i>" : ""}</small>
    <span>${perQuarterChips(fx.morale, fx.hype, u.revenue)}${upkeep ? chip(`Upkeep ${fmt(upkeep)}/q`, "bad") : ""}${block && !owned ? chip(block, "neutral") : ""}</span>
  </button>`;
}

async function shop() {
  for (;;) {
    const o = office(s);
    const list = UPGRADES.filter((u) => (s.office === "remote" ? u.remote !== "no" : u.remote !== "only"));
    const r = await modal(
      `<h2>🛍️ Office shop</h2>
      <p class="sub">${o.emoji} ${esc(o.name)} · ${s.upgrades.length}/${o.upgradeSlots} perk slots used · cash ${fmt(s.cash)}. Buying doesn't use a decision. Upkeep adds to your burn; the novelty wears off after ${NOVELTY_QUARTERS} quarters.</p>
      <div class="choices">${list.map(upgradeCard).join("")}</div>`,
      [{ label: "Done shopping", value: "close" }],
    );
    if (!r.value.startsWith("buy:")) return;
    const id = r.value.slice(4);
    if (upgradeBlocker(s, id)) continue;
    buyUpgrade(s, id);
    music.play("kaching");
    render();
    scene.sparkle();
  }
}

// ---------- 1:1 conversations ----------

async function talkTo(id: number) {
  if (busy) return;
  const e = s.employees.find((x) => x.id === id);
  if (!e) return;
  const mood = employeeMood(s, e);
  const already = e.talkedQuarter === s.quarter;
  const owns = ownedBy(s, e.id);
  const canFire = s.actionsLeft > 0;
  const memories = e.history.slice(-3).reverse();
  const boss = managerOf(s, e);
  const r = await modal(
    `<h2>${esc(e.name)}${e.contractor ? " <small>(contractor)</small>" : ""}</h2>
    <p class="sub">${esc(titleOf(e))}${boss ? ` · reports to ${esc(boss.name)}` : ""} · mood ${mood}/100 · ${fmt(payOf(e))}/q${owns.length ? ` · <b>only one who understands ${owns.map((k) => `${SYSTEMS[k].emoji} ${SYSTEMS[k].name}`).join(", ")}</b>` : ""}</p>
    <p><i>${esc(e.name.split(" ")[0])} ${esc(e.quirk)}.</i>${e.knowsZug ? " <i>Looks at you a little too long whenever someone says “Switzerland”.</i>" : ""}</p>
    ${memories.length ? `<div class="memories"><b>They remember:</b>${memories.map((m) => `<p>• ${esc(m)}</p>`).join("")}</div>` : ""}
    ${boss && !already ? `<p class="sub">⚠️ Skip-level: ${esc(boss.name.split(" ")[0])} will hear you went around them.</p>` : ""}
    ${already ? "<p>You already had a 1:1 this quarter. They're avoiding eye contact.</p>" : ""}`,
    [
      { label: canFire ? "Let them go (1 decision)" : "Let them go (no decisions left)", value: canFire ? "fire" : "cancel" },
      ...(already ? [{ label: "Leave them alone", value: "cancel" }] : [
        { label: "Never mind", value: "cancel" },
        { label: "Say it", value: "go", primary: true },
      ]),
    ],
    already ? {} : { input: `Hey ${e.name.split(" ")[0]}, got a minute? I wanted to talk about...` },
  );
  if (r.value === "fire") return fire(e);
  if (r.value !== "go") return;
  await withBusy(async () => {
    loading(`${e.name.split(" ")[0]} is thinking about how honest to be...`);
    const j = await judged("employee", r.text, { npc: npcOf(e) });
    const d = { morale: clamp(j.deltas.morale, -6, 6), hype: clamp(j.deltas.hype, -3, 3), suspicion: j.deltas.suspicion };
    applyEffects(s, { morale: Math.round(d.morale / 2), hype: d.hype, suspicion: d.suspicion });
    e.moodOffset = clamp(e.moodOffset + d.morale * 2, -50, 50);
    e.talkedQuarter = s.quarter;
    if (j.memory) remember(e, s.quarter, j.memory);
    if (boss) {
      boss.moodOffset = clamp(boss.moodOffset - 4, -50, 50);
      remember(boss, s.quarter, `The CEO went around me for a 1:1 with ${e.name.split(" ")[0]}.`);
    }
    addPromises(j, e);
    log(s, `1:1 with ${e.name}: ${j.narration}`);
    showReactions(j, e.id);
    await modal(judgementHtml(`1:1 with ${e.name}`, j, "", { morale: d.morale, hype: d.hype, suspicion: d.suspicion }), [{ label: "OK", value: "ok" }]);
  });
}

async function fire(e: Employee) {
  const owns = ownedBy(s, e.id);
  const r = await modal(
    `<h2>Let ${esc(e.name)} go?</h2>
    <p>Saves ${fmt(payOf(e))} per quarter.${owns.length ? ` <b>Nobody else understands ${owns.map((k) => `${SYSTEMS[k].emoji} ${SYSTEMS[k].name}`).join(", ")}.</b> It will start to rot.` : ""}</p>
    <p class="sub">They'll remember this. So will everyone who watches.</p>`,
    [
      { label: "Keep them", value: "no" },
      { label: "Fire", value: "yes" },
    ],
  );
  if (r.value !== "yes") return;
  removeEmployee(s, e.id, "fired");
  rememberAll(s, `Watched ${e.name.split(" ")[0]} get fired.`);
  applyEffects(s, { morale: -6, hype: 2 });
  s.actionsLeft--;
  log(s, `Fired ${e.name}. Security walked them out with a box and a cactus.`);
  render();
  scene.layoffShock();
  music.play("layoff");
}

// ---------- team list ----------

const moodFace = (m: number) => (m > 65 ? "😄" : m > 45 ? "🙂" : m > 30 ? "😐" : m > 15 ? "😠" : "🤬");

async function team() {
  // key people first, then the unhappiest - those are the ones worth a conversation
  const people = [...s.employees].sort((a, b) => ownedBy(s, b.id).length - ownedBy(s, a.id).length || employeeMood(s, a) - employeeMood(s, b));
  const rows = people.map((e) => {
    const m = employeeMood(s, e);
    const owns = ownedBy(s, e.id);
    const tags = [
      owns.length ? chip(owns.map((k) => `${SYSTEMS[k].emoji} ${SYSTEMS[k].name}`).join(" "), "neutral") : "",
      e.contractor ? chip("💼 contractor", "neutral") : "",
      e.desk < 0 && s.office !== "remote" ? chip("no desk", "bad") : "",
      e.talkedQuarter === s.quarter ? chip("talked this Q", "neutral") : "",
      s.promises.some((p) => p.text.includes(`(to ${e.name})`)) ? chip("📝 you owe them", "bad") : "",
    ].join("");
    return `<button class="choice person" data-v="talk:${e.id}">
      <b>${moodFace(m)} ${esc(e.name)} <span class="price">${fmt(payOf(e))}/q</span></b>
      <small>${esc(titleOf(e))}${managerOf(s, e) ? ` → ${esc(managerOf(s, e)!.name.split(" ")[0])}` : ""} · mood ${m} · ${esc(e.quirk)}</small>
      ${tags ? `<span>${tags}</span>` : ""}
    </button>`;
  });
  const r = await modal(
    `<h2>👥 Team <small>${s.employees.length} people</small></h2>
    <p class="sub">Key people first, then whoever is closest to quitting. Click someone for a 1:1.</p>
    <div class="choices team">${rows.join("")}</div>`,
    [
      { label: `📇 Alumni (${s.alumni.length})`, value: "alumni" },
      { label: "Close", value: "close" },
    ],
    { wide: true },
  );
  if (r.value === "alumni") return alumni();
  if (!r.value.startsWith("talk:")) return;
  const id = Number(r.value.slice(5));
  scene.focus(id);
  await talkTo(id);
}

// ---------- org chart ----------

async function orgChart() {
  const plan = new Map<number, OrgChange>(s.employees.map((e) => [e.id, { id: e.id, managerId: managerOf(s, e)?.id ?? null, title: e.title ?? null }]));
  let warn = "";
  const promise = modal(
    `<h2>🏛️ Org chart</h2>
    <p class="sub">Nothing changes until you announce the reorg (1 decision). Titles cost money; taking one away costs more than money.</p>
    <div id="org-body"></div>`,
    [
      { label: "Close", value: "close" },
      { label: s.actionsLeft > 0 ? "Announce reorg…" : "Announce reorg (no decisions left)", value: s.actionsLeft > 0 ? "go" : "close" },
    ],
    { wide: true },
  );
  let sel: number | null = null;
  const moveTo = (id: number, to: number | null) => {
    const pm = new Map([...plan.values()].map((c) => [c.id, c.managerId]));
    if (to === id) return;
    if (wouldCycle(s, id, to, pm)) warn = "That would make someone their own boss. Even for a startup, no.";
    else plan.get(id)!.managerId = to;
  };
  const draw = () => {
    // preview on a copy so the real company only changes on announce
    const sim = structuredClone(s);
    for (const e of sim.employees) {
      const c = plan.get(e.id)!;
      e.managerId = c.managerId;
      e.title = c.title ?? undefined;
    }
    const moodOf = (x: Employee) => employeeMood(s, s.employees.find((o) => o.id === x.id)!);
    const orig = (id: number) => s.employees.find((x) => x.id === id)!;
    const pm = new Map([...plan.values()].map((c) => [c.id, c.managerId]));
    const selName = sel !== null ? sim.employees.find((x) => x.id === sel)?.name.split(" ")[0] : "";
    // when someone is selected, every valid new boss offers an explicit button
    const putHere = (target: number | null) =>
      sel === null || target === sel || plan.get(sel)!.managerId === target || wouldCycle(s, sel, target, pm)
        ? ""
        : `<button class="oc-put" data-put="${target ?? "ceo"}">⤵ Put ${esc(selName ?? "")} here</button>`;
    const card = (e: Employee) => {
      const team = reportsOf(sim, e.id);
      const m = moodOf(e);
      const owns = ownedBy(s, e.id);
      const was = orig(e.id);
      const changed = (managerOf(s, was)?.id ?? null) !== e.managerId || (was.title ?? null) !== (e.title ?? null);
      const warns = [
        team.length > MANAGER_SPAN ? "drowning in reports" : "",
        e.title && e.title !== "lead" && !team.length ? "title, no team" : "",
        owns.length && team.length >= 3 ? `neglects ${owns.map((k) => SYSTEMS[k].emoji).join("")}` : "",
      ].filter(Boolean);
      const effect = team.length ? (m >= 60 ? `<span class="good">+10%</span>` : m <= 30 ? `<span class="bad">−10%</span>` : "") : "";
      return `<div class="oc-card ${sel === e.id ? "sel" : ""} ${warns.length ? "warn" : ""} ${changed ? "changed" : ""}" data-id="${e.id}" draggable="true" title="${esc(warns.join("; ") || `${e.name}, mood ${m}. Drag onto someone to move.`)}">
        <span class="oc-top">${moodFace(m)} ${owns.map((k) => SYSTEMS[k].emoji).join("")}${team.length ? ` <span class="oc-team">👥${team.length}</span>` : ""} ${effect}</span>
        <b>${esc(e.name)}</b>
        <small>${esc(titleOf(e))}</small>
        ${warns.length ? `<small class="oc-warn">⚠ ${esc(warns.join(" · "))}</small>` : ""}
        ${putHere(e.id)}
      </div>`;
    };
    const node = (e: Employee): string => `<li>${card(e)}${children(reportsOf(sim, e.id))}</li>`;
    // individual contributors stack in a column under their manager; sub-managers branch out
    const children = (kids: Employee[]) => {
      if (!kids.length) return "";
      const leaves = kids.filter((k) => !reportsOf(sim, k.id).length);
      const branches = kids.filter((k) => reportsOf(sim, k.id).length);
      const stack = leaves.length ? `<li class="oc-stack"><div class="oc-col">${leaves.map(card).join("")}</div></li>` : "";
      return `<ul>${branches.map(node).join("")}${stack}</ul>`;
    };
    const top = reportsOf(sim, null);
    const span = top.length;
    const depth = orgDepth(sim);
    const deleg = delegates(sim, moodOf);
    const cost = [...plan.values()].reduce((a, c) => {
      const before = orig(c.id).title;
      return a + (c.title ? TITLES[c.title].premium : 0) - (before ? TITLES[before].premium : 0);
    }, 0);
    const changed = s.employees.filter((e) => {
      const c = plan.get(e.id)!;
      return (managerOf(s, e)?.id ?? null) !== c.managerId || (e.title ?? null) !== c.title;
    }).length;
    const picked = sel !== null ? sim.employees.find((x) => x.id === sel) : undefined;
    const inspector = picked
      ? `<div class="oc-inspect">
        <div class="oc-inspect-head"><b>${esc(picked.name)}</b><span class="sub">${esc(picked.role)}</span><button class="oc-x" data-close>✕</button></div>
        <label class="oc-field">Reports to
          <select id="oc-boss">${[`<option value="ceo">👔 You (CEO)</option>`, ...sim.employees.filter((x) => x.id !== picked.id && !wouldCycle(s, picked.id, x.id, pm)).map((x) => `<option value="${x.id}" ${picked.managerId === x.id ? "selected" : ""}>${esc(x.name)} — ${esc(titleOf(x))}</option>`)].join("")}</select>
        </label>
        <div class="oc-field">Title</div>
        <div class="oc-titles">${[null, ...TITLE_IDS]
          .map((k) => `<button data-t="${k ?? ""}" class="${(picked.title ?? null) === k ? "on" : ""}">${esc(k ? titleOf({ ...picked, title: k }) : picked.role)}${k ? ` <small>+${fmt(TITLES[k].premium)}/q</small>` : ""}</button>`)
          .join("")}</div></div>`
      : `<div class="oc-inspect"><span class="sub">👆 Click a person to change their title or boss. Shortcut: drag a card onto their new boss.</span></div>`;
    $("#org-body").innerHTML = `
      <div class="chips">
        ${chip(`${span} report to you`, span > CEO_SPAN ? "bad" : "good")}
        ${deleg ? chip("🧭 Delegation: +1 decision", "good") : ""}
        ${chip(`${depth} layer${depth === 1 ? "" : "s"}`, depth > HEALTHY_DEPTH ? "bad" : "neutral")}
        ${cost ? chip(`Payroll ${cost > 0 ? "+" : ""}${fmt(cost)}/q`, cost > 0 ? "bad" : "good") : ""}
        ${changed ? chip(`${changed} change${changed === 1 ? "" : "s"}`, "neutral") : ""}
      </div>
      ${span > CEO_SPAN ? `<p class="sub bad">⚠️ More than ${CEO_SPAN} people report to you: your calendar eats one decision every quarter.</p>` : ""}
      ${depth > HEALTHY_DEPTH ? `<p class="sub bad">⚠️ ${depth} layers: revenue −${(depth - HEALTHY_DEPTH) * 4}% to alignment meetings.</p>` : ""}
      ${warn ? `<p class="sub bad">${esc(warn)}</p>` : ""}
      ${inspector}
      <div class="oc-wrap"><ul class="oc"><li><div class="oc-card ceo" data-id="ceo"><span class="oc-top">👔</span><b>You</b><small>CEO · ${span} direct</small>${putHere(null)}</div>${children(top)}</li></ul></div>
      <p class="sub">🧭 ≤4 direct reports and every manager running a happy team of 3–${MANAGER_SPAN} = +1 decision per quarter. Managers in a good mood (60+) get 10% more out of their team. When someone leaves, their manager inherits their systems.</p>`;
    warn = "";
    const body = $("#org-body");
    body.querySelectorAll<HTMLElement>(".oc-card").forEach((el) => {
      const id = el.dataset.id === "ceo" ? null : Number(el.dataset.id);
      el.addEventListener("click", (ev) => {
        const put = (ev.target as HTMLElement).closest<HTMLElement>("[data-put]");
        if (put && sel !== null) moveTo(sel, put.dataset.put === "ceo" ? null : Number(put.dataset.put));
        else if (id !== null) sel = sel === id ? null : id;
        draw();
      });
      el.addEventListener("dragstart", (ev) => {
        if (id === null) return ev.preventDefault();
        ev.dataTransfer?.setData("text/plain", String(id));
        el.classList.add("dragging");
      });
      el.addEventListener("dragover", (ev) => {
        ev.preventDefault();
        el.classList.add("drop");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drop"));
      el.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const from = Number(ev.dataTransfer?.getData("text/plain"));
        if (!Number.isNaN(from) && from !== id) moveTo(from, id);
        draw();
      });
    });
    body.querySelector<HTMLSelectElement>("#oc-boss")?.addEventListener("change", (ev) => {
      const v = (ev.target as HTMLSelectElement).value;
      if (sel !== null) moveTo(sel, v === "ceo" ? null : Number(v));
      draw();
    });
    body.querySelector("[data-close]")?.addEventListener("click", () => {
      sel = null;
      draw();
    });
    body.querySelectorAll<HTMLButtonElement>(".oc-titles button").forEach((b) =>
      b.addEventListener("click", () => {
        if (sel === null) return;
        plan.get(sel)!.title = (b.dataset.t || null) as Title | null;
        draw();
      }),
    );
  };
  draw();
  const r = await promise;
  if (r.value !== "go") return;
  const changes = [...plan.values()].filter((c) => {
    const e = s.employees.find((x) => x.id === c.id)!;
    return (managerOf(s, e)?.id ?? null) !== c.managerId || (e.title ?? null) !== c.title;
  });
  if (!changes.length) return;
  const a = await modal(
    `<h2>📣 Announce the reorg</h2><p class="sub">${changes.length} change${changes.length === 1 ? "" : "s"}. Everyone will read it twice, looking for their own name.</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "Send to all-staff", value: "go", primary: true },
    ],
    { input: "Team, to better align with our next phase of growth, I'm excited to share some changes to our structure..." },
  );
  if (a.value !== "go") return;
  await withBusy(async () => {
    loading("Everyone is refreshing the org chart in Notion...");
    const res = applyReorg(s, changes, s.quarter, remember);
    const j = await judged("reorg", a.text, { reorg: res.lines });
    applyEffects(s, j.deltas);
    addPromises(j);
    s.actionsLeft--;
    log(s, `Reorg (${res.lines.length} changes): ${j.narration}`);
    showReactions(j);
    const list = `<div class="memories"><b>What changed:</b>${res.lines.map((l) => `<p>• ${esc(l)}</p>`).join("")}</div>`;
    await modal(judgementHtml("Reorg announced", j, list), [{ label: "Back to work", value: "ok" }]);
  });
}

// ---------- alumni ----------

function alumnusStatus(a: Alumnus) {
  if (a.blewWhistle) return "📂 talking to auditors";
  if (a.atCompetitor) return "🏃 at a competitor";
  if (a.grudge >= 60) return "😠 holds a grudge";
  if (a.grudge >= 35) return "😒 bitter";
  return "🙂 over it";
}

async function alumni() {
  const rows = s.alumni.map((a) => {
    const block = rehireBlocker(s, a) ?? (s.actionsLeft <= 0 ? "No decisions left" : null);
    return `<button class="choice" data-v="rehire:${a.id}" ${block ? "disabled" : ""}>
      <b>${esc(a.name)} <span class="price">${fmt(a.salary * 3)}/q as contractor</span></b>
      <small>${esc(a.role)} · ${a.reason} in Q${a.leftQuarter} · ${alumnusStatus(a)}${a.owned.length ? ` · knew ${a.owned.map((k) => `${SYSTEMS[k].emoji} ${SYSTEMS[k].name}`).join(", ")}` : ""}</small>
      ${block ? `<span>${chip(block, "neutral")}</span>` : ""}
    </button>`;
  });
  const r = await modal(
    `<h2>📇 Alumni</h2>
    <p class="sub">Everyone who left. They remember why. Rehiring one as a contractor costs a decision and 3× their old pay — if they agree.</p>
    <div class="choices">${rows.join("") || "<p>Nobody has left yet. Give it time.</p>"}</div>`,
    [{ label: "Close", value: "close" }],
  );
  if (!r.value.startsWith("rehire:")) return;
  const a = s.alumni.find((x) => x.id === Number(r.value.slice(7)));
  if (!a || rehireBlocker(s, a)) return;
  const pitchText = await modal(
    `<h2>Call ${esc(a.name)}</h2>
    <p class="sub">${alumnusStatus(a)} · ${a.reason} in Q${a.leftQuarter}</p>
    ${a.history.length ? `<div class="memories"><b>They remember:</b>${a.history.slice(-4).reverse().map((m) => `<p>• ${esc(m)}</p>`).join("")}</div>` : ""}`,
    [
      { label: "Hang up", value: "cancel" },
      { label: "Make the call", value: "go", primary: true },
    ],
    { input: `Hey ${a.name.split(" ")[0]}, long time! So... funny story about ${a.owned[0] ? SYSTEMS[a.owned[0]].name.toLowerCase() : "the company"}...` },
  );
  if (pitchText.value !== "go") return;
  await withBusy(async () => {
    loading(`${a.name.split(" ")[0]} is deciding whether to block your number...`);
    const j = await judged("rehire", pitchText.text, { npc: { name: a.name, role: a.role, quirk: a.quirk, mood: 100 - a.grudge, history: a.history, grudge: a.grudge, owns: a.owned.map((k) => SYSTEMS[k].name.toLowerCase()) } });
    s.actionsLeft--;
    if (j.memory) remember(a, s.quarter, j.memory);
    applyEffects(s, { hype: clamp(j.deltas.hype, -3, 3), suspicion: j.deltas.suspicion });
    let extra: string;
    if (j.accepted) {
      rehire(s, a.id);
      const back = s.employees.find((e) => e.id === a.id);
      if (back) addPromises(j, back);
      extra = `<p class="big good">🤝 ${esc(a.name)} is coming back — as a contractor, at 3× the price.</p>`;
    } else {
      a.refusedQuarter = s.quarter;
      a.grudge = clamp(a.grudge + 5, 0, 100);
      extra = `<p class="big bad">📵 ${esc(a.name)} said no. Possibly in more words than that.</p>`;
    }
    log(s, `Called ${a.name}: ${j.narration}`);
    await modal(judgementHtml(`Call with ${a.name}`, j, extra), [{ label: "OK", value: "ok" }]);
  });
}

// ---------- board meetings ----------

async function boardMeeting() {
  music.play("board");
  const reasons = s.boardDemands.splice(0);
  const r = await modal(
    `<p class="kicker">Mandatory</p><h2>📋 The board wants a word</h2>
    <p>Before anything else this quarter, explain these:</p>
    <div class="memories">${reasons.map((x) => `<p>• ${esc(x)}</p>`).join("")}</div>
    <p class="sub">Vague answers raise suspicion. Owning it with a plan helps. Blaming a former employee might work — they may hear about it.</p>`,
    [{ label: "Face the board", value: "go", primary: true }],
    { input: "Thank you all for being here. Let me start by saying this was an industry-wide issue..." },
  );
  loading("The board is exchanging looks...");
  const j = await judged("board", r.text, { eventTitle: `Board meeting about: ${reasons.join(" | ")}` });
  applyEffects(s, j.deltas);
  addPromises(j);
  for (const a of s.alumni) if (r.text.toLowerCase().includes(a.name.split(" ")[0].toLowerCase())) {
    a.grudge = clamp(a.grudge + 15, 0, 100);
    remember(a, s.quarter, "Heard the CEO blamed them in front of the board.");
  }
  log(s, `Board meeting: ${j.narration}`);
  render();
  await modal(judgementHtml("Board meeting", j), [{ label: "Back to work", value: "ok" }]);
}

async function boardVote() {
  s.lastBoardVote = s.quarter;
  const members = boardMembers(s);
  const m = pickMotion(s);
  music.play("board");
  const r = await modal(
    `<p class="kicker">Q${s.quarter} board meeting · ${members.length + 1} votes, the chair breaks ties</p><h2>🗳️ Motion: ${esc(m.title)}</h2>
    <p>${esc(m.text)}</p>
    <div class="memories"><b>Around the table:</b>${members.map((c) => `<p>• <b>${esc(c.name)}</b> — ${esc(c.role)}${c.history.length ? `<br><span class="sub">${esc(c.history[c.history.length - 1])}</span>` : ""}</p>`).join("")}<p>• <b>You</b> — voting no</p></div>
    <p class="sub">Argue against it, or vote with them and look like a team player.</p>`,
    [
      { label: "Vote with the board", value: "concede" },
      { label: "Argue against", value: "go", primary: true },
    ],
    { input: "With respect, I think this motion misreads where we are. Here's what I propose instead..." },
  );
  let extra: string;
  let j: Judgement | null = null;
  if (r.value === "concede") {
    const did = enactMotion(s, m);
    rememberVote(s, m, true, members.map((c) => ({ name: c.name, vote: "yes" })));
    applyEffects(s, { suspicion: -3 });
    log(s, `Board meeting: you voted for "${m.title}" yourself. ${did}`);
    extra = `<p class="big">🤝 Unanimous.</p><p>${esc(did)}</p>`;
  } else {
    loading("The board is voting...");
    j = await judged("boardvote", r.text, { board: { motion: `${m.title}: ${m.text}`, members: members.map((c) => c.name) } });
    applyEffects(s, j.deltas);
    addPromises(j);
    const t = tally(s, j.votes ?? []);
    rememberVote(s, m, t.passed, t.cast);
    const lines = t.cast
      .map((c) => {
        const said = j!.votes?.find((v) => v.name.toLowerCase().includes(c.name.split(" ")[0].toLowerCase()))?.line;
        return `<p class="quote"><b>${c.vote === "yes" ? "✋ Yes" : "🙅 No"} — ${esc(c.name)}:</b> ${said ? `“${esc(said)}”` : ""}</p>`;
      })
      .join("");
    const did = t.passed ? enactMotion(s, m) : "";
    log(s, `Board vote on "${m.title}": ${t.passed ? "passed" : "failed"} ${t.yes}-${t.no}. ${did}`);
    extra = `${lines}<p class="big ${t.passed ? "bad" : "good"}">${t.passed ? `🔨 Passed ${t.yes}–${t.no}.` : `🛡️ Defeated ${t.no}–${t.yes}.`}</p>${did ? `<p>${esc(did)}</p>` : ""}`;
    j.reactions = [];
  }
  render();
  const html = j ? judgementHtml(`Board vote: ${m.title}`, j, extra) : `<h2>Board vote: ${esc(m.title)}</h2>${extra}`;
  await modal(html, [{ label: s.over ? "Pack your desk" : "Back to work", value: "ok" }]);
}

async function ceoPanel() {
  if (busy) return;
  const r = await modal(
    `<h2>🕶️ Your private finances</h2>
    <div class="ledger">
      <p>Savings (salary): <b>${fmt(s.savings)}</b></p>
      <p>Offshore account (Zug): <b>${fmt(s.offshore)}</b></p>
      <p>Equity: <b>${(s.equity * 100).toFixed(1)}%</b> ≈ ${fmt(valuation(s) * s.equity)} on paper</p>
      <p>Reputation: <b>${s.reputation}/100</b></p>
      <p>Net worth: <b>${fmt(netWorth(s))}</b> of ${fmt(FIRE_TARGET)} FIRE target</p>
    </div>
    ${s.threads.length ? `<h3>📖 Storylines</h3>${s.threads.map((t) => `<details><summary><b>${esc(t.title)}</b> · ${t.open ? "ongoing" : "closed"} · ${t.episodes.length} ep.</summary>${t.episodes.map((e) => `<p class="sub">${esc(e)}</p>`).join("")}</details>`).join("")}` : ""}
    ${s.cast.length ? `<h3>🎭 People who know you</h3>${s.cast.map((c) => `<p>• <b>${esc(c.name)}</b> — ${esc(c.role)}${c.history.length ? `<br><span class="sub">${esc(c.history[c.history.length - 1])}</span>` : ""}</p>`).join("")}` : ""}
    ${s.kpis.length ? `<h3>What you promised investors</h3>${s.kpis.map((k) => `<p>• “${esc(k.quote)}” — ${KPI_LABEL[k.metric]} ${k.metric === "revenue" || k.metric === "valuation" ? fmt(k.target) : k.target} by Q${k.dueQuarter}</p>`).join("")}` : ""}
    ${s.promises.length ? `<h3>Open promises</h3>${s.promises.map((p) => `<p>• ${esc(p.text)} — due Q${p.dueQuarter}, ~${fmt(p.cost)}</p>`).join("")}` : ""}`,
    [
      { label: "Resign & start over", value: "resign" },
      { label: "Close", value: "ok" },
    ],
  );
  if (r.value === "resign") await newGame();
}

// ---------- quarterly report ----------

function snapshot() {
  return {
    cash: s.cash,
    revenue: quarterlyRevenue(s),
    costs: costBreakdown(s),
    morale: s.morale,
    hype: s.hype,
    suspicion: s.suspicion,
    valuation: valuation(s),
    staff: s.employees.length,
    netWorth: netWorth(s),
    systems: Object.fromEntries(SYSTEM_IDS.map((k) => [k, s.systems[k].health])) as Record<SystemId, number>,
  };
}

function quarterReportHtml(q: number, b: ReturnType<typeof snapshot>, lines: string[]) {
  const arrow = (d: number, goodUp = true) =>
    d === 0 ? `<span class="d">±0</span>` : `<span class="d ${(d > 0) === goodUp ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  const money = (d: number, goodUp = true) =>
    d === 0 ? "" : `<span class="d ${(d > 0) === goodUp ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${fmt(Math.abs(d))}</span>`;
  const c = b.costs;
  const costTotal = c.payroll + c.rent + c.perks + c.you + c.saas;
  const net = b.revenue - costTotal;
  const runway = runwayQuarters(s);
  const pl = [
    ["💰 Revenue", b.revenue, "good"],
    ["👥 Payroll", -c.payroll, ""],
    [`${office(s).emoji} Rent`, -c.rent, ""],
    ...(c.perks ? [["🛍️ Perk upkeep", -c.perks, ""]] : []),
    ["🧩 SaaS licences", -c.saas, ""],
    [c.you ? "🕶️ Your salary" : "🕶️ Your salary (frozen)", -c.you, ""],
  ] as [string, number, string][];
  const vital = (label: string, cls: string, from: number, to: number, goodUp = true) =>
    `<div class="vital"><span>${label}</span><div class="bar ${cls}"><i style="width:${to}%"></i></div><b>${to}</b>${arrow(to - from, goodUp)}</div>`;
  const tone = (l: string) =>
    /🚨|📉|Broken promise|quit\.|📂|⭐|🏃|📨|Incident|nobody understands|miserable|eats|wall-to-wall|of nobody|no desk|layers of management/i.test(l)
      ? "bad"
      : /✅|🎯|kept a promise|adopted|crisis is over/i.test(l)
        ? "good"
        : "";
  const story = lines.filter((l) => !/^Revenue |^Systems: /.test(l));
  const fire = Math.min(100, (netWorth(s) / FIRE_TARGET) * 100);
  return `<p class="kicker">Quarterly report · ${esc(s.company)}</p><h2>Q${q} closed</h2>
    <div class="qr">
      <section class="qr-card">
        <h3>P&amp;L</h3>
        ${pl.map(([k, v, cls]) => `<div class="pl ${cls}"><span>${k}</span><b>${v >= 0 ? "+" : "−"}${fmt(Math.abs(v))}</b></div>`).join("")}
        <div class="pl total ${net >= 0 ? "good" : "bad"}"><span>${net >= 0 ? "Profit" : "Burn"}</span><b>${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))}</b></div>
        <div class="pl cashline"><span>Cash</span><b>${fmt(b.cash)} → ${fmt(s.cash)}</b></div>
        <p class="sub">${runway === Infinity ? "Profitable. Investors are confused." : `Runway ${runway.toFixed(1)} quarters.`}</p>
      </section>
      <section class="qr-card">
        <h3>Vitals</h3>
        ${vital("Morale", "morale", b.morale, s.morale)}
        ${vital("Hype", "hype", b.hype, s.hype)}
        ${vital("Suspicion", "susp", b.suspicion, s.suspicion, false)}
        <div class="pl"><span>📈 Valuation</span><b>${fmt(valuation(s))} ${money(valuation(s) - b.valuation)}</b></div>
        <div class="pl"><span>👥 Staff</span><b>${s.employees.length} ${arrow(s.employees.length - b.staff)}</b></div>
        <div class="pl"><span>🏝️ Your net worth</span><b>${fmt(netWorth(s))} ${money(netWorth(s) - b.netWorth)}</b></div>
        <div class="bar fire"><i style="width:${fire}%"></i></div>
        <p class="sub">${Math.round(fire)}% of the way to FIRE (${fmt(FIRE_TARGET)}).</p>
      </section>
    </div>
    <section class="qr-card">
      <h3>Systems</h3>
      <div class="qr-sys">${SYSTEM_IDS.map((k) => {
        const h = s.systems[k].health;
        const o = s.employees.find((e) => e.id === s.systems[k].owner);
        return `<div class="sys ${s.crises.includes(k) ? "crisis" : ""}">
          <span>${SYSTEMS[k].emoji} ${SYSTEMS[k].name}</span>
          <div class="bar ${h < 30 ? "susp" : h < 55 ? "warn" : "morale"}"><i style="width:${h}%"></i></div>
          <b>${h}</b>${arrow(h - b.systems[k])}
          <small>${o ? esc(o.name) : "<em>nobody</em>"}${s.crises.includes(k) ? " · 🚨 crisis" : ""}</small>
        </div>`;
      }).join("")}</div>
    </section>
    ${story.length ? `<section class="qr-card"><h3>What happened</h3>${story.map((l) => `<p class="qr-line ${tone(l)}">${esc(l)}</p>`).join("")}</section>` : ""}`;
}

// ---------- quarter loop ----------

/** Ask for this quarter's event; the engine decides whether it's the next episode of a storyline. */
function requestEvent() {
  const thread = nextEpisodeFor(s);
  const story = {
    continueTitle: thread?.title,
    final: thread ? thread.episodes.length >= MAX_EPISODES - 1 : false,
    canStart: !thread && s.threads.filter((t) => t.open).length < MAX_OPEN_THREADS,
  };
  return api<GameEvent>("/api/event", { context: describe(s), recentTitles: s.recentEvents, story });
}

/** File the resolved event under its storyline (if it has one). */
function storyEpisode(ev: GameEvent, summary: string) {
  if (!ev.storyline?.title) return;
  const r = recordEpisode(s, ev.storyline.title, `${ev.title} — ${summary}`, ev.storyline.ends);
  if (r && r.episode === 1) log(s, `📖 New storyline: "${r.thread.title}".`);
}

function storyKicker(ev: GameEvent) {
  const t = ev.storyline?.title;
  if (!t) return `Q${s.quarter} event`;
  const existing = s.threads.find((x) => x.open && x.title.toLowerCase() === t.toLowerCase());
  const n = (existing?.episodes.length ?? 0) + 1;
  return `📖 ${esc(t)} · episode ${n}${ev.storyline!.ends ? " · finale" : ""}`;
}

// The next event is generated in the background while the player reads the
// quarterly report / intro screen, so the LLM latency is mostly hidden.
let pendingEvent: Promise<GameEvent> | null = null;

function prefetchEvent() {
  const p = requestEvent();
  p.catch(() => {}); // surfaced when awaited
  pendingEvent = p;
}

async function startQuarter() {
  await withBusy(async () => {
    if (s.boardDemands.length) await boardMeeting();
    if (s.quarter % BOARD_EVERY === 0 && s.lastBoardVote < s.quarter) await boardVote();
    if (s.over) return;
    loading(`Q${s.quarter}: something is happening at ${s.company}...`);
    const ev = await (pendingEvent ?? requestEvent());
    pendingEvent = null;
    s.recentEvents = [ev.title, ...s.recentEvents].slice(0, 6);
    s.eventResolvedQuarter = s.quarter; // a reload after this point won't re-roll the event
    renderHud();
    const r = await modal(
      `<p class="kicker">${storyKicker(ev)}</p><h2>${esc(ev.title)}</h2><p>${esc(ev.description)}</p>
      <div class="choices">${ev.choices.map((c, i) => `<button class="choice" data-v="choice:${i}">${esc(c.label)}<span>${deltaChips(c.effects)}${c.company?.name || c.company?.product ? chip(`🔀 ${c.company.name || c.company.product}`, "neutral") : ""}${(c.people ?? []).map((p) => chip(`👤 ${p.name.split(" ")[0]}${p.salary_change ? ` ${p.salary_change > 0 ? "+" : ""}${fmt(p.salary_change)}/q` : ""}`, p.mood_change >= 0 ? "good" : "bad")).join("")}</span></button>`).join("")}</div>
      <p class="sub">…or respond in your own words:</p>`,
      [{ label: "Respond with my text", value: "text", primary: true }],
      { input: "Write your own response (the game master will judge it)" },
    );
    if (r.value.startsWith("choice:")) {
      const c = ev.choices[Number(r.value.slice(7))];
      const touched = applyPeople(s, c.people);
      const identity = changeIdentity(s, c.company);
      const hc = c.effects.headcount < 0 ? Math.min(0, c.effects.headcount + (touched.left ?? 0)) : c.effects.headcount;
      const { gone } = applyEffects(s, { ...c.effects, headcount: hc });
      if (c.effects.offshore > 0) noticeZug(s);
      log(s, `${ev.title} → ${c.label}. ${c.outcome}`);
      storyEpisode(ev, `CEO chose "${c.label}": ${c.outcome}`);
      render();
      await modal(`<h2>${esc(c.label)}</h2><p class="narr">${esc(c.outcome)}</p>${identity ? `<p class="big">🔀 ${esc(identity[0].toUpperCase() + identity.slice(1))}.</p>` : ""}${peopleHtml(touched)}<div class="chips">${deltaChips(c.effects)}</div>
        ${gone.length ? `<p>Gone: ${gone.map((g) => esc(g.name)).join(", ")}</p>` : ""}`, [{ label: "OK", value: "ok" }]);
    } else {
      loading("The game master is judging your response...");
      const span = (k: "cash" | "headcount") => {
        const vals = ev.choices.map((c) => c.effects[k]);
        return [Math.min(...vals), Math.max(...vals)] as [number, number];
      };
      const j = await judged("event", r.text, { eventTitle: `${ev.title}: ${ev.description}`, bounds: { cash: span("cash"), headcount: span("headcount") } });
      const touched = applyPeople(s, j.people);
      j.people = []; // already applied; judgementHtml shouldn't apply them again
      const hc = j.consequences.headcount < 0 ? Math.min(0, j.consequences.headcount + (touched.left ?? 0)) : j.consequences.headcount;
      const { gone } = applyEffects(s, { ...j.deltas, ...j.consequences, headcount: hc });
      if (gone.length) log(s, `Gone: ${gone.map((g) => g.name).join(", ")}.`);
      addPromises(j);
      log(s, `${ev.title} → you improvised. ${j.narration}`);
      storyEpisode(ev, `CEO improvised: "${r.text.slice(0, 160)}". ${j.narration}`);
      showReactions(j);
      render();
      await modal(judgementHtml(ev.title, j, peopleHtml(touched), { ...j.deltas, ...j.consequences }), [{ label: "OK", value: "ok" }]);
    }
  });
  if (s.over) return gameOver();
  gossip();
}

async function gossip() {
  try {
    const g = await api<{ headline: string; gossip: { name: string; line: string }[]; mock: boolean }>("/api/gossip", {
      context: describe(s),
      names: s.employees.map((e) => e.name),
    });
    log(s, `📰 ${g.headline}`);
    render();
    g.gossip.forEach((line, i) => {
      const e = speakerToEmployee(line.name);
      if (e) setTimeout(() => scene.bubble(e.id, line.line), 1500 + i * 5500);
    });
  } catch {
    /* gossip is decoration */
  }
}

async function nextQuarter() {
  if (busy) return;
  if (s.actionsLeft > 0) {
    const r = await modal(`<h2>End quarter?</h2><p>You still have ${s.actionsLeft} decision(s) left. Doing nothing is also a strategy (it's called "focus").</p>`, [
      { label: "Stay", value: "no" },
      { label: "End quarter", value: "yes" },
    ]);
    if (r.value !== "yes") return;
  }
  const q = s.quarter;
  const crisesBefore = s.crises.length;
  const before = snapshot();
  const report = endQuarter(s);
  if (s.crises.length > crisesBefore) music.play("crisis");
  report.lines.forEach((l) => log(s, l));
  render();
  if (s.over) return gameOver();
  prefetchEvent();
  await modal(quarterReportHtml(q, before, report.lines), [{ label: `Start Q${s.quarter}`, value: "ok", primary: true }], { wide: true });
  await startQuarter();
}

interface Epilogue {
  headline: string;
  article: string;
  controversies: string[];
  linkedin: { name: string; role: string; post: string }[];
}

function epilogueHtml(e: Epilogue | null) {
  if (!e) return "";
  return `<div class="epilogue">
    <p class="kicker">How they'll remember ${esc(s.company)}</p>
    <h3>📰 ${esc(e.headline)}</h3>
    <p>${esc(e.article)}</p>
    ${e.controversies.length ? `<h4>Wikipedia · Controversies</h4>${e.controversies.map((c) => `<p>• ${esc(c)}</p>`).join("")}` : ""}
    ${e.linkedin.map((l) => `<div class="li"><b>${esc(l.name)}</b> <small>${esc(l.role)}</small><p>${esc(l.post)}</p></div>`).join("")}
  </div>`;
}

async function gameOver() {
  const o = s.over!;
  loading(`Writing ${s.company}'s obituary...`);
  const epilogue = await api<Epilogue & { mock: boolean }>("/api/epilogue", {
    context: describe(s),
    ending: `${o.title}. ${o.text}`,
    history: [
      ...s.log,
      ...s.threads.map((t) => `Storyline "${t.title}": ${t.episodes.join(" → ")}`),
      ...s.alumni.map((a) => `${a.name} (${a.role}) ${a.reason} in Q${a.leftQuarter}; remembers: ${a.history.slice(-3).join(" / ")}`),
    ].join("\n"),
  }).catch(() => null);
  const r = await modal(
    `<p class="kicker">${o.win ? "You win" : "Game over"}</p><h2>${esc(o.title)}</h2><p>${esc(o.text)}</p>
    <p>Final net worth: <b>${fmt(netWorth(s))}</b> after ${s.career} compan${s.career === 1 ? "y" : "ies"}.</p>
    ${epilogueHtml(epilogue)}`,
    o.canContinue
      ? [
          { label: "Restart from scratch", value: "restart" },
          { label: "Take a new CEO job", value: "next", primary: false },
        ]
      : [{ label: "Play again", value: "restart" }],
  );
  s = r.value === "next" ? newCompany(s) : newCompany();
  scene.sync([]);
  render();
  await intro();
}

async function newGame() {
  const r = await modal(`<h2>Resign and start over?</h2><p>Your current career (net worth ${fmt(netWorth(s))}) will be lost. Like tears in rain. Or equity in a down round.</p>`, [
    { label: "Keep playing", value: "no" },
    { label: "New game", value: "yes" },
  ]);
  if (r.value !== "yes") return;
  clearSave();
  pendingEvent = null;
  s = newCompany();
  scene.sync([]);
  render();
  await intro();
}

async function welcomeBack() {
  const r = await modal(
    `<p class="kicker">Saved game</p><h2>Welcome back to ${esc(s.company)}</h2>
    <p>Q${s.quarter}, ${s.employees.length} employees, ${fmt(s.cash)} in the bank. Net worth ${fmt(netWorth(s))} of ${fmt(FIRE_TARGET)}.</p>
    <p class="sub">Nobody noticed you were gone. That's either great or concerning.</p>`,
    [
      { label: "New game", value: "new" },
      { label: "Continue", value: "continue", primary: false },
    ],
  );
  if (r.value === "new") {
    clearSave();
    s = newCompany();
    scene.sync([]);
    render();
    return intro();
  }
  if (s.over) return gameOver();
  if (s.eventResolvedQuarter < s.quarter) return startQuarter();
  void gossip();
}

/** Only what the world knows before the company exists - not the placeholder name or roster. */
function genesisContext() {
  return [
    `Office: ${office(s).name} (${office(s).blurb}). Starting cash ${fmt(s.cash)}. ${s.employees.length} employees.`,
    s.career > 1 ? `This is the CEO's company #${s.career}. Reputation ${s.reputation}/100. Previous companies: ${s.formerly.concat(s.log.filter((l) => l.includes("former employee"))).join("; ") || "unknown"}.` : "This is the CEO's first company.",
    `People who know the CEO: ${s.cast.map((c) => `${c.name} (${c.role})`).join("; ")}.`,
  ].join("\n");
}

async function intro() {
  if (s.quarter === 1 && !s.genesisDone) {
    loading("Incorporating in Delaware...");
    try {
      const g = await api<Genesis & { mock: boolean }>("/api/genesis", { context: genesisContext(), staff: s.employees.length, roles: ROLES });
      if (g.employees.length) applyGenesis(s, g);
    } catch {
      /* keep the randomly generated company */
    }
    s.genesisDone = true;
    render();
  }
  prefetchEvent();
  await modal(
    `<p class="kicker">${s.career > 1 ? `Career move #${s.career}` : "Welcome aboard"}</p>
    <h2>You are the new CEO of ${esc(s.company)}</h2>
    ${s.founding ? `<p><i>${esc(s.founding)}</i></p>` : ""}
    <p>The product: <b>${esc(s.product)}</b>. ${s.employees.length} employees, ${fmt(s.cash)} in the bank, a ${office(s).emoji} ${esc(office(s).name.toLowerCase())} and a board that trusts you (for now).</p>
    <p>Your official goal: grow the company. Your <i>actual</i> goal: <b>FIRE</b> — ${fmt(FIRE_TARGET)} of personal net worth.
    Get there with an honest IPO… or with creative “consulting fees” to a lovely little company in Zug. Just keep an eye on that suspicion bar.</p>
    <p class="sub">Tip: most things can be answered in your own words — the game master is an LLM and it is judging you.</p>`,
    [{ label: s.career > 1 ? "Update LinkedIn & start" : "Let's disrupt 🚀", value: "go", primary: false }],
  );
  await startQuarter();
}

// ---------- boot ----------

// browsers only allow audio after a user gesture; the intro button is the first one
document.addEventListener("pointerdown", () => void music.start(), { once: true });
$("#hud").addEventListener("click", (e) => {
  if ((e.target as HTMLElement).id !== "mute") return;
  void music.start();
  music.toggleMute();
  renderHud();
});

// Render at native device resolution (crisp vectors); the scene camera zooms to fit.
const host = $("#game");
const dpr = Math.min(window.devicePixelRatio || 1, 3);
const hostSize = () => ({ w: Math.max(320, host.clientWidth), h: Math.max(240, host.clientHeight) });
const initial = hostSize();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#e9ecf8",
  antialias: true,
  // Only react to pointer events that actually hit the canvas, never clicks on HTML modals above it.
  input: { windowEvents: false },
  scale: { mode: Phaser.Scale.NONE, width: initial.w * dpr, height: initial.h * dpr, zoom: 1 / dpr },
  scene: [],
});
window.addEventListener("resize", () => {
  const { w, h } = hostSize();
  game.scale.resize(w * dpr, h * dpr);
});

game.scene.add("office", OfficeScene, true, {
  cb: {
    onEmployeeClick: (id: number) => modalOpen() || void talkTo(id),
    onCeoClick: () => modalOpen() || void ceoPanel(),
    getMood: (id: number) => {
      const e = s.employees.find((x) => x.id === id);
      return e ? employeeMood(s, e) : 50;
    },
    getValuation: () => fmt(valuation(s)),
    getBadge: (id: number) => {
      const e = s.employees.find((x) => x.id === id);
      return (e ? ownedBy(s, id).map((k) => SYSTEMS[k].emoji).join("") : "") + (e?.contractor ? "💼" : "");
    },
    inCrisis: () => s.crises.length > 0,
    onReady: (sc: OfficeScene) => {
      scene = sc;
      render();
      void (saved ? welcomeBack() : intro());
    },
  },
});
