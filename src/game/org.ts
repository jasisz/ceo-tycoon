// Org chart: who reports to whom, and what you called them. Structure has consequences:
// a CEO with too many direct reports loses decisions to 1:1s, managers' moods leak into their
// teams, deep hierarchies hold meetings about meetings, and titles cost money and pride.

import type { Employee, GameState } from "./state";

export type Title = "lead" | "head" | "vp" | "chief";

export const TITLES: Record<Title, { label: string; premium: number; rank: number }> = {
  lead: { label: "Team Lead", premium: 5_000, rank: 1 },
  head: { label: "Head of", premium: 10_000, rank: 2 },
  vp: { label: "VP", premium: 20_000, rank: 3 },
  chief: { label: "Chief … Officer", premium: 35_000, rank: 4 },
};
export const TITLE_IDS = Object.keys(TITLES) as Title[];

/** More direct reports than this and the CEO's calendar eats a decision every quarter. */
export const CEO_SPAN = 6;
/** A manager with more reports than this can't keep up; their team feels it. */
export const MANAGER_SPAN = 8;
/** Layers below the CEO before meetings start breeding meetings. */
export const HEALTHY_DEPTH = 3;

export function titleOf(e: Employee) {
  if (!e.title) return e.role;
  const area = e.role.replace(/ (Dev|Engineer|Rep|Manager|Partner|Hacker|Master)$/, "");
  return e.title === "lead" ? `${e.role} Lead` : e.title === "head" ? `Head of ${area}` : e.title === "vp" ? `VP of ${area}` : `Chief ${area} Officer`;
}

/** The manager, or null if they report to the CEO (or their manager is gone). */
export function managerOf(s: GameState, e: Employee): Employee | null {
  return e.managerId == null ? null : (s.employees.find((m) => m.id === e.managerId) ?? null);
}

export const reportsOf = (s: GameState, id: number | null) =>
  s.employees.filter((e) => (id === null ? managerOf(s, e) === null : e.managerId === id));

export const ceoSpan = (s: GameState) => reportsOf(s, null).length;

export function depthOf(s: GameState, e: Employee): number {
  let d = 1;
  let m = managerOf(s, e);
  const seen = new Set([e.id]);
  while (m && !seen.has(m.id)) {
    seen.add(m.id);
    d++;
    m = managerOf(s, m);
  }
  return d;
}

export const orgDepth = (s: GameState) => s.employees.reduce((a, e) => Math.max(a, depthOf(s, e)), 0);

/** Revenue lost to status meetings, alignment syncs and pre-meetings for the alignment syncs. */
export const bureaucracyDrag = (s: GameState) => Math.max(0, orgDepth(s) - HEALTHY_DEPTH) * 0.04;

/** Would putting `id` under `managerId` create a loop? */
export function wouldCycle(s: GameState, id: number, managerId: number | null, plan?: Map<number, number | null>) {
  let m = managerId;
  const seen = new Set<number>();
  while (m != null) {
    if (m === id || seen.has(m)) return true;
    seen.add(m);
    m = plan?.has(m) ? plan.get(m)! : (s.employees.find((e) => e.id === m)?.managerId ?? null);
  }
  return false;
}

/** Someone leaves: their team moves up a level. */
export function orphanReports(s: GameState, gone: Employee) {
  for (const r of s.employees) if (r.managerId === gone.id) r.managerId = gone.managerId ?? null;
}

/** New hires join the manager with the most room, or report to the CEO if there isn't one. */
export function placeHire(s: GameState, e: Employee) {
  const managers = s.employees.filter((m) => m.title && m.id !== e.id && reportsOf(s, m.id).length < MANAGER_SPAN);
  managers.sort((a, b) => reportsOf(s, a.id).length - reportsOf(s, b.id).length);
  e.managerId = managers[0]?.id ?? null;
}

export interface OrgChange {
  id: number;
  managerId: number | null;
  title: Title | null;
}

export interface ReorgResult {
  lines: string[]; // what changed, for the LLM and the log
  cost: number; // per-quarter salary delta
}

/** Apply a new structure. Promotions and demotions change pay and get remembered. */
export function applyReorg(s: GameState, plan: OrgChange[], quarter: number, remember: (e: Employee, q: number, t: string) => void): ReorgResult {
  const lines: string[] = [];
  let cost = 0;
  const name = (id: number | null) => (id == null ? "the CEO" : (s.employees.find((e) => e.id === id)?.name ?? "the CEO"));
  for (const c of plan) {
    const e = s.employees.find((x) => x.id === c.id);
    if (!e) continue;
    const oldTitle = e.title ?? null;
    if (oldTitle !== c.title) {
      const before = oldTitle ? TITLES[oldTitle] : null;
      const after = c.title ? TITLES[c.title] : null;
      const delta = (after?.premium ?? 0) - (before?.premium ?? 0);
      const oldName = titleOf(e);
      e.title = c.title ?? undefined;
      e.salary += delta;
      cost += delta;
      if ((after?.rank ?? 0) > (before?.rank ?? 0)) {
        e.moodOffset = Math.min(50, e.moodOffset + 10);
        remember(e, quarter, `Got promoted to ${titleOf(e)}.`);
        lines.push(`${e.name} promoted: ${oldName} → ${titleOf(e)} (${delta >= 0 ? "+" : ""}${delta}/q)`);
      } else {
        e.moodOffset = Math.max(-50, e.moodOffset - 15);
        remember(e, quarter, `Got demoted from ${oldName} to ${titleOf(e)} in a reorg. Pay cut.`);
        lines.push(`${e.name} demoted: ${oldName} → ${titleOf(e)} (${delta}/q)`);
      }
    }
    if ((e.managerId ?? null) !== c.managerId && !wouldCycle(s, e.id, c.managerId)) {
      const from = name(e.managerId ?? null);
      e.managerId = c.managerId;
      remember(e, quarter, `Reorg: now reports to ${name(c.managerId)} instead of ${from}.`);
      lines.push(`${e.name} now reports to ${name(c.managerId)} (was ${from})`);
    }
  }
  return { lines, cost };
}

/** Quarterly consequences of the structure. Returns report lines. */
export function stepOrg(s: GameState, mood: (e: Employee) => number): string[] {
  const lines: string[] = [];
  for (const m of s.employees) {
    const team = reportsOf(s, m.id);
    if (!team.length) {
      if (m.title && m.title !== "lead") lines.push(`${m.name} is ${titleOf(m)} of nobody. The team has noticed.`);
      continue;
    }
    // a manager's mood leaks into the team, for better or worse
    const mm = mood(m);
    for (const r of team) {
      const pull = Math.max(-3, Math.min(3, Math.round((mm - mood(r)) / 10)));
      r.moodOffset = Math.max(-50, Math.min(50, r.moodOffset + pull - (team.length > MANAGER_SPAN ? 2 : 0)));
    }
    if (mm < 30) lines.push(`${m.name} (${titleOf(m)}) is miserable, and so is their team.`);
    if (team.length > MANAGER_SPAN) lines.push(`${m.name} manages ${team.length} people and hasn't had lunch since Q${s.quarter - 1}.`);
  }
  const vanity = s.employees.filter((e) => e.title && e.title !== "lead" && !reportsOf(s, e.id).length).length;
  if (vanity) s.morale = Math.max(0, s.morale - vanity);
  const drag = bureaucracyDrag(s);
  if (drag) lines.push(`${orgDepth(s)} layers of management: revenue −${Math.round(drag * 100)}% to alignment meetings.`);
  return lines;
}

/** Investors love a full C-suite. Up to +3 hype a quarter. */
export const cSuiteHype = (s: GameState) => Math.min(3, s.employees.filter((e) => e.title === "chief").length);

/** Compact org chart for the LLM. */
export function describeOrg(s: GameState) {
  const managers = s.employees.filter((e) => reportsOf(s, e.id).length || e.title);
  if (!managers.length) return `Org chart: flat, all ${s.employees.length} people report directly to the CEO.`;
  const top = reportsOf(s, null);
  return `Org chart: ${top.length} report directly to the CEO. ${managers
    .slice(0, 10)
    .map((m) => {
      const team = reportsOf(s, m.id);
      return `${m.name} is ${titleOf(m)}${team.length ? ` managing ${team.map((r) => r.name.split(" ")[0]).join(", ")}` : " with no reports"}${m.managerId != null ? `, reports to ${managerOf(s, m)?.name ?? "the CEO"}` : ""}`;
    })
    .join("; ")}. ${orgDepth(s)} layers deep.`;
}

/** A healthy team: 3..MANAGER_SPAN people under a manager who isn't miserable. */
export function healthyTeams(s: GameState, mood: (e: Employee) => number) {
  return s.employees.filter((m) => {
    const n = reportsOf(s, m.id).length;
    return n >= 3 && n <= MANAGER_SPAN && mood(m) >= 50;
  });
}

/** Delegation: few direct reports and every team in good hands frees up one of your decisions. */
export function delegates(s: GameState, mood: (e: Employee) => number) {
  const managers = s.employees.filter((m) => reportsOf(s, m.id).length);
  return ceoSpan(s) <= 4 && managers.length > 0 && healthyTeams(s, mood).length === managers.length;
}

/** Effective headcount for revenue: a good manager gets 10% more out of people, a miserable one 10% less. */
export function teamOutput(s: GameState, mood: (e: Employee) => number) {
  return s.employees.reduce((a, e) => {
    const m = managerOf(s, e);
    if (!m) return a + 1;
    const mm = mood(m);
    return a + (mm >= 60 ? 1.1 : mm <= 30 ? 0.9 : 1);
  }, 0);
}
