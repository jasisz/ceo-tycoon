import Phaser from "phaser";
import "./style.css";
import { OfficeScene } from "./scene/OfficeScene";
import {
  ACTIONS_PER_QUARTER,
  FIRE_TARGET,
  MAX_DESKS,
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
  type Effects,
  type GameState,
} from "./game/state";

// ---------- API ----------

interface Judgement {
  deltas: { morale: number; hype: number; suspicion: number };
  narration: string;
  reactions: { speaker: string; line: string }[];
  promises: { text: string; quarters_until_due: number; cost: number }[];
  bullshit_score: number;
  mock: boolean;
}
interface GameEvent {
  title: string;
  description: string;
  choices: { label: string; outcome: string; effects: Required<Effects> }[];
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
      ${num("Staff", `${s.employees.length}/${MAX_DESKS}`)}
    </div>
    <div class="fire" title="Savings + offshore. Reach ${fmt(FIRE_TARGET)} to retire.">
      <span>FIRE ${fmt(netWorth(s))} / ${fmt(FIRE_TARGET)}</span>
      <div class="bar fireb"><i style="width:${fire}%"></i></div>
    </div>
    ${mockMode ? `<div class="mock" title="No API key found - game master is a dumb heuristic">MOCK GM</div>` : ""}
  `;
}

function renderLog() {
  $("#log").innerHTML = `<h3>Company log</h3>` + s.log.map((l) => `<p>${esc(l)}</p>`).join("");
}

interface Action {
  id: string;
  label: string;
  hint: string;
  cost?: string;
  enabled: () => boolean;
  run: () => Promise<void> | void;
}

const ACTIONS: Action[] = [
  { id: "allhands", label: "📣 All-hands speech", hint: "Write a speech. The LLM judges how it lands.", enabled: () => true, run: allHands },
  {
    id: "pitch",
    label: "💼 Pitch investors",
    hint: "Raise money. Success depends on hype and your pitch.",
    enabled: () => s.quarter - s.lastRaiseQuarter >= 2,
    run: pitch,
  },
  { id: "layoff", label: "✂️ Lay off 10%", hint: "Investors: efficiency! Employees: fear.", enabled: () => s.employees.length > 1, run: layoffs },
  { id: "hire", label: "🧑‍💻 Hire 2 people", hint: "Recruiting fees $40k", cost: "$40k", enabled: () => s.employees.length < MAX_DESKS, run: hireTwo },
  { id: "party", label: "🎉 Winter party", hint: "Once a year. $6k per head.", enabled: () => s.quarter - s.lastPartyQuarter >= 4, run: party },
  { id: "bonus", label: "💸 Promise a bonus", hint: "Morale now, bill in 2 quarters.", enabled: () => !s.promises.some((p) => p.text.startsWith("Bonus for everyone")), run: promiseBonus },
  { id: "pivot", label: "🔀 Pivot", hint: "New product. Hype up, morale down.", enabled: () => true, run: pivot },
  { id: "offshore", label: "🏝️ 'Consulting fee' to Zug", hint: "$250k to your offshore account. Suspicious.", enabled: () => s.cash > 250_000, run: offshore },
  { id: "ipo", label: "🔔 IPO", hint: "Q6+, valuation ≥ $60M. Cash out your equity.", enabled: () => canIPO(s), run: doIpo },
];

function renderActions() {
  const left = s.actionsLeft;
  $("#actions").innerHTML = `
    <h3>Decisions <small>${left}/${ACTIONS_PER_QUARTER} left this quarter</small></h3>
    ${ACTIONS.filter((a) => a.id !== "ipo" || canIPO(s))
      .map((a) => `<button data-a="${a.id}" title="${esc(a.hint)}" ${busy || left <= 0 || !a.enabled() ? "disabled" : ""}>${a.label}</button>`)
      .join("")}
    <p class="tip">Click an employee for a 1:1 (free). Click yourself (sunglasses) for your finances.</p>
    <button class="end" data-a="end" ${busy ? "disabled" : ""}>End quarter ▶</button>
    <button class="newgame" data-a="new" ${busy ? "disabled" : ""}>↺ New game</button>
  `;
}

function render() {
  saveGame(s);
  renderHud();
  renderActions();
  renderLog();
  scene?.sync(s.employees);
  scene?.setOffshore(s.offshore);
}

$("#actions").addEventListener("click", async (e) => {
  const id = (e.target as HTMLElement).closest("button")?.dataset.a;
  if (!id || busy) return;
  if (id === "end") return nextQuarter();
  if (id === "new") return newGame();
  const a = ACTIONS.find((x) => x.id === id);
  if (!a || !a.enabled() || s.actionsLeft <= 0) return;
  await a.run();
  render();
});

// ---------- modal ----------

interface Btn {
  label: string;
  value: string;
  primary?: boolean;
}

function modal(html: string, buttons: Btn[], opts: { input?: string } = {}): Promise<{ value: string; text: string }> {
  const m = $("#modal");
  const card = $("#modal-card");
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

function addPromises(j: Judgement) {
  for (const p of j.promises) {
    s.promises.push({ text: p.text, dueQuarter: s.quarter + clamp(p.quarters_until_due, 1, 4), cost: clamp(p.cost, 0, 2_000_000) });
    log(s, `You promised: "${p.text}". Someone wrote it down.`);
  }
}

async function judged(scene_: string, text: string, extra: Record<string, unknown> = {}) {
  return api<Judgement>("/api/judge", { scene: scene_, text, context: describe(s), ...extra });
}

function judgementHtml(title: string, j: Judgement, extra = "", deltas: Partial<Record<string, number>> = j.deltas) {
  return `<h2>${esc(title)}</h2>
    <p class="narr">${esc(j.narration)}</p>
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
    await modal(judgementHtml("Pitch result", j, extra), [{ label: "OK", value: "ok" }]);
  });
}

async function layoffs() {
  const n = Math.max(1, Math.round(s.employees.length * 0.1));
  const gone = removeEmployees(s, n);
  applyEffects(s, { morale: -15, hype: 6 });
  s.actionsLeft--;
  log(s, `Laid off ${gone.map((e) => e.name).join(", ")}. LinkedIn post: "Hardest decision of my life."`);
  render();
  scene.layoffShock();
  setTimeout(() => {
    const e = s.employees[0];
    if (e) scene.bubble(e.id, "Am I next?");
  }, 1500);
}

function hireTwo() {
  s.cash -= 40_000;
  const n = hire(s, 2);
  applyEffects(s, { morale: 2 });
  s.actionsLeft--;
  log(s, `Hired ${n} people. They ask where the free snacks are.`);
}

function party() {
  const cost = 6_000 * s.employees.length;
  s.cash -= cost;
  s.lastPartyQuarter = s.quarter;
  applyEffects(s, { morale: 16 });
  s.actionsLeft--;
  log(s, `Winter party for ${fmt(cost)}. Someone from Finance did karaoke. Morale restored.`);
  scene.party();
}

function promiseBonus() {
  const cost = 8_000 * s.employees.length;
  s.promises.push({ text: "Bonus for everyone", dueQuarter: s.quarter + 2, cost });
  applyEffects(s, { morale: 10 });
  s.actionsLeft--;
  log(s, `You promised everyone a bonus (${fmt(cost)}, due Q${s.quarter + 2}).`);
  const e = s.employees[Math.floor(Math.random() * s.employees.length)];
  if (e) scene.bubble(e.id, "I'll believe it when I see it.");
}

function pivot() {
  const old = s.product;
  const options = PRODUCTS.filter((p) => p !== old);
  s.product = options[Math.floor(Math.random() * options.length)];
  applyEffects(s, { hype: 14, morale: -8 });
  s.actionsLeft--;
  log(s, `Pivot! From "${old}" to "${s.product}". Engineering found out from TechCrunch.`);
}

function offshore() {
  applyEffects(s, { cash: -250_000, offshore: 250_000, suspicion: 14 });
  s.actionsLeft--;
  log(s, `Paid a $250k "strategic consulting" invoice to a company in Zug.`);
  scene.ceoBubble("Strategic consulting. Very strategic.");
  scene.moneyFly();
}

async function doIpo() {
  ipo(s);
  render();
  await gameOver();
}

// ---------- 1:1 conversations ----------

async function talkTo(id: number) {
  if (busy) return;
  const e = s.employees.find((x) => x.id === id);
  if (!e) return;
  const mood = employeeMood(s, e);
  const already = e.talkedQuarter === s.quarter;
  const r = await modal(
    `<h2>${esc(e.name)}</h2><p class="sub">${esc(e.role)} · mood ${mood}/100</p><p><i>${esc(e.name.split(" ")[0])} ${esc(e.quirk)}.</i></p>
    ${already ? "<p>You already had a 1:1 this quarter. They're avoiding eye contact.</p>" : ""}`,
    already ? [{ label: "Leave them alone", value: "cancel" }] : [
      { label: "Never mind", value: "cancel" },
      { label: "Say it", value: "go", primary: true },
    ],
    already ? {} : { input: `Hey ${e.name.split(" ")[0]}, got a minute? I wanted to talk about...` },
  );
  if (r.value !== "go") return;
  await withBusy(async () => {
    loading(`${e.name.split(" ")[0]} is thinking about how honest to be...`);
    const j = await judged("employee", r.text, { npc: { name: e.name, role: e.role, quirk: e.quirk, mood } });
    const d = { morale: clamp(j.deltas.morale, -6, 6), hype: clamp(j.deltas.hype, -3, 3), suspicion: j.deltas.suspicion };
    applyEffects(s, { morale: Math.round(d.morale / 2), hype: d.hype, suspicion: d.suspicion });
    e.moodOffset = clamp(e.moodOffset + d.morale * 2, -50, 50);
    e.talkedQuarter = s.quarter;
    addPromises(j);
    log(s, `1:1 with ${e.name}: ${j.narration}`);
    showReactions(j, e.id);
    await modal(judgementHtml(`1:1 with ${e.name}`, j, "", { morale: d.morale, hype: d.hype, suspicion: d.suspicion }), [{ label: "OK", value: "ok" }]);
  });
}

async function ceoPanel() {
  if (busy) return;
  await modal(
    `<h2>🕶️ Your private finances</h2>
    <div class="ledger">
      <p>Savings (salary): <b>${fmt(s.savings)}</b></p>
      <p>Offshore account (Zug): <b>${fmt(s.offshore)}</b></p>
      <p>Equity: <b>${(s.equity * 100).toFixed(1)}%</b> ≈ ${fmt(valuation(s) * s.equity)} on paper</p>
      <p>Reputation: <b>${s.reputation}/100</b></p>
      <p>Net worth: <b>${fmt(netWorth(s))}</b> of ${fmt(FIRE_TARGET)} FIRE target</p>
    </div>
    ${s.promises.length ? `<h3>Open promises</h3>${s.promises.map((p) => `<p>• ${esc(p.text)} — due Q${p.dueQuarter}, ~${fmt(p.cost)}</p>`).join("")}` : ""}`,
    [{ label: "Close", value: "ok" }],
  );
}

// ---------- quarter loop ----------

// The next event is generated in the background while the player reads the
// quarterly report / intro screen, so the LLM latency is mostly hidden.
let pendingEvent: Promise<GameEvent> | null = null;

function prefetchEvent() {
  const p = api<GameEvent>("/api/event", { context: describe(s), recentTitles: s.recentEvents });
  p.catch(() => {}); // surfaced when awaited
  pendingEvent = p;
}

async function startQuarter() {
  await withBusy(async () => {
    loading(`Q${s.quarter}: something is happening at ${s.company}...`);
    const ev = await (pendingEvent ?? api<GameEvent>("/api/event", { context: describe(s), recentTitles: s.recentEvents }));
    pendingEvent = null;
    s.recentEvents = [ev.title, ...s.recentEvents].slice(0, 6);
    s.eventResolvedQuarter = s.quarter; // a reload after this point won't re-roll the event
    renderHud();
    const r = await modal(
      `<p class="kicker">Q${s.quarter} event</p><h2>${esc(ev.title)}</h2><p>${esc(ev.description)}</p>
      <div class="choices">${ev.choices.map((c, i) => `<button class="choice" data-v="choice:${i}">${esc(c.label)}<span>${deltaChips(c.effects)}</span></button>`).join("")}</div>
      <p class="sub">…or respond in your own words:</p>`,
      [{ label: "Respond with my text", value: "text", primary: true }],
      { input: "Write your own response (the game master will judge it)" },
    );
    if (r.value.startsWith("choice:")) {
      const c = ev.choices[Number(r.value.slice(7))];
      const { gone } = applyEffects(s, c.effects);
      log(s, `${ev.title} → ${c.label}. ${c.outcome}`);
      render();
      await modal(`<h2>${esc(c.label)}</h2><p class="narr">${esc(c.outcome)}</p><div class="chips">${deltaChips(c.effects)}</div>
        ${gone.length ? `<p>Gone: ${gone.map((g) => esc(g.name)).join(", ")}</p>` : ""}`, [{ label: "OK", value: "ok" }]);
    } else {
      loading("The game master is judging your response...");
      const j = await judged("event", r.text, { eventTitle: `${ev.title}: ${ev.description}` });
      applyEffects(s, j.deltas);
      addPromises(j);
      log(s, `${ev.title} → you improvised. ${j.narration}`);
      showReactions(j);
      await modal(judgementHtml(ev.title, j), [{ label: "OK", value: "ok" }]);
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
  const report = endQuarter(s);
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

async function gameOver() {
  const o = s.over!;
  const r = await modal(
    `<p class="kicker">${o.win ? "You win" : "Game over"}</p><h2>${esc(o.title)}</h2><p>${esc(o.text)}</p>
    <p>Final net worth: <b>${fmt(netWorth(s))}</b> after ${s.career} compan${s.career === 1 ? "y" : "ies"}.</p>`,
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
  const r = await modal(`<h2>Start a new game?</h2><p>Your current career (net worth ${fmt(netWorth(s))}) will be lost. Like tears in rain. Or equity in a down round.</p>`, [
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
    <p>The company makes a <b>${esc(s.product)}</b>. ${s.employees.length} employees, ${fmt(s.cash)} in the bank and a board that trusts you (for now).</p>
    <p>Your official goal: grow the company. Your <i>actual</i> goal: <b>FIRE</b> — ${fmt(FIRE_TARGET)} of personal net worth.
    Get there with an honest IPO… or with creative “consulting fees” to a lovely little company in Zug. Just keep an eye on that suspicion bar.</p>
    <p class="sub">Tip: most things can be answered in your own words — the game master is an LLM and it is judging you.</p>`,
    [{ label: s.career > 1 ? "Update LinkedIn & start" : "Let's disrupt 🚀", value: "go", primary: false }],
  );
  await startQuarter();
}

// ---------- boot ----------

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
    onReady: (sc: OfficeScene) => {
      scene = sc;
      render();
      void (saved ? welcomeBack() : intro());
    },
  },
});
