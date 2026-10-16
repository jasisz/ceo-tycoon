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
  payZug,
  zugSuspicion,
  ZUG_AMOUNT,
  recordEpisode,
  MAX_EPISODES,
  MAX_OPEN_THREADS,
  type PersonEffect,
  type Alumnus,
  type Employee,
  type Effects,
  type GameState,
} from "./game/state";
import { FLOOR_COST, FLOOR_DESKS, FLOOR_RENT, OFFICES, UPGRADES, type OfficeTier, type UpgradeSpec } from "./game/office";

// ---------- API ----------

interface Judgement {
  deltas: { morale: number; hype: number; suspicion: number };
  consequences: { cash: number; headcount: number };
  memory: string;
  accepted: boolean;
  people: PersonEffect[];
  company: IdentityChange;
  kpis: { quote: string; metric: "revenue" | "headcount" | "valuation" | "hype"; multiplier: number; quarters: number }[];
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
    id: "hire",
    group: "people",
    icon: "🧑‍💻",
    label: "Hire +2",
    hint: "Recruiting fees $40k. Beyond your desk count, people hot-desk (morale penalty).",
    enabled: () => s.employees.length < maxHeadcount(s),
    sub: () => (s.employees.length >= maxHeadcount(s) ? "no room" : s.employees.length + 2 > capacity(s) ? "$40k · no desks!" : "$40k"),
    run: hireTwo,
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
    label: "'Consulting fee' to Zug",
    hint: "$250k from the company to your offshore account (Herr Brunner keeps 10%). Each transfer is more suspicious than the last.",
    enabled: () => s.cash > ZUG_AMOUNT,
    sub: () => `$250k · suspicion +${zugSuspicion(s)} · stash ${fmt(s.offshore)}`,
    run: offshore,
  },
];

function renderActions() {
  const left = s.actionsLeft;
  const pips = Array.from({ length: ACTIONS_PER_QUARTER }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("");
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

async function pitch() {
  const r = await modal(
    `<h2>💼 Investor pitch</h2><p>Valuation ${fmt(valuation(s))}, revenue ${fmt(quarterlyRevenue(s))}/q, burn ${fmt(Math.max(0, quarterlyCosts(s) - quarterlyRevenue(s)))}/q. Three partners from a VC fund stare at you over oat-milk lattes. Pitch.</p>`,
    [
      { label: "Cancel", value: "cancel" },
      { label: "Pitch", value: "go", primary: true },
    ],
    { input: "We're not a SaaS, we're a platform. Think Uber, but for..." },
  );
  if (r.value !== "go") return;
  await withBusy(async () => {
    const arrived = scene.investorsArrive();
    loading("Investors are nodding thoughtfully...");
    const [j] = await Promise.all([judged("investors", r.text), arrived]);
    applyEffects(s, j.deltas);
    addPromises(j);
    for (const k of j.kpis) addKpi(s, k.quote, k.metric, k.multiplier, k.quarters);
    const kpiHtml = s.kpis.length
      ? `<p class="promise">📝 Investors wrote down: ${j.kpis.map((k) => `“${esc(k.quote)}”`).join(", ") || "nothing new"}. They will check.</p>`
      : "";
    s.actionsLeft--;
    s.lastRaiseQuarter = s.quarter;
    let extra: string;
    if (s.hype >= 35) {
      const raised = Math.round((valuation(s) * 0.15 * s.hype) / 60);
      s.cash += raised;
      s.equity *= 0.85;
      extra = `<p class="big good">💰 Raised ${fmt(raised)}! Your equity is diluted to ${(s.equity * 100).toFixed(1)}%.</p>`;
      log(s, `Raised ${fmt(raised)} from investors.`);
      scene.investorsLeave(true);
    } else {
      extra = `<p class="big bad">🚪 "We'll circle back." They will not circle back.</p>`;
      log(s, "Investors passed.");
      scene.investorsLeave(false);
    }
    await modal(judgementHtml("Pitch result", j, extra + kpiHtml), [{ label: "OK", value: "ok" }]);
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

function offshore() {
  music.play("zug");
  const susp = payZug(s);
  s.actionsLeft--;
  log(s, `Paid a $250k "strategic consulting" invoice to a company in Zug (Herr Brunner kept 10%). Suspicion +${susp}.`);
  scene.ceoBubble("Strategic consulting. Very strategic.");
  scene.moneyFly();
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
  return `<button class="choice" data-v="buy:${u.id}" ${block ? "disabled" : ""}>
    <b>${u.emoji} ${esc(u.name)} <span class="price">${price}</span></b>
    <small>${esc(u.blurb)}</small>
    <span>${perQuarterChips(u.morale, u.hype, u.revenue)}${block && !owned ? chip(block, "neutral") : ""}</span>
  </button>`;
}

async function shop() {
  for (;;) {
    const o = office(s);
    const list = UPGRADES.filter((u) => (s.office === "remote" ? u.remote !== "no" : u.remote !== "only"));
    const r = await modal(
      `<h2>🛍️ Office shop</h2>
      <p class="sub">${o.emoji} ${esc(o.name)} · ${s.upgrades.length}/${o.upgradeSlots} perk slots used · cash ${fmt(s.cash)}. Buying doesn't use a decision.</p>
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
  const r = await modal(
    `<h2>${esc(e.name)}${e.contractor ? " <small>(contractor)</small>" : ""}</h2>
    <p class="sub">${esc(e.role)} · mood ${mood}/100 · ${fmt(payOf(e))}/q${owns.length ? ` · <b>only one who understands ${owns.map((k) => `${SYSTEMS[k].emoji} ${SYSTEMS[k].name}`).join(", ")}</b>` : ""}</p>
    <p><i>${esc(e.name.split(" ")[0])} ${esc(e.quirk)}.</i>${e.knowsZug ? " <i>Looks at you a little too long whenever someone says “Switzerland”.</i>" : ""}</p>
    ${memories.length ? `<div class="memories"><b>They remember:</b>${memories.map((m) => `<p>• ${esc(m)}</p>`).join("")}</div>` : ""}
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
      <small>${esc(e.role)} · mood ${m} · ${esc(e.quirk)}</small>
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
  const report = endQuarter(s);
  if (s.crises.length > crisesBefore) music.play("crisis");
  report.lines.forEach((l) => log(s, l));
  render();
  if (s.over) return gameOver();
  prefetchEvent();
  await modal(
    `<p class="kicker">Quarterly report</p><h2>Q${q} closed</h2>${report.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`,
    [{ label: `Start Q${s.quarter}`, value: "ok" }],
  );
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

async function intro() {
  prefetchEvent();
  await modal(
    `<p class="kicker">${s.career > 1 ? `Career move #${s.career}` : "Welcome aboard"}</p>
    <h2>You are the new CEO of ${esc(s.company)}</h2>
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
