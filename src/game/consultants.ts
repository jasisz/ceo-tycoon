// Reorg consultants: pay someone to redraw the org chart for you. The more you pay, the more
// likely the structure makes sense, but every engagement is a roll of the dice. The engine
// designs the plan; the player still has to announce it (and own it).

import type { Employee, GameState } from "./state";
import { SYSTEM_IDS, SYSTEMS } from "./state";
import { CEO_SPAN, MANAGER_SPAN, managerOf, type OrgChange, TITLE_IDS, TITLES } from "./org";

export type ConsultantId = "cousin" | "boutique" | "prestige";

export const CONSULTANTS: Record<ConsultantId, { name: string; emoji: string; blurb: string; fee: number; skill: number; deck: string[]; pitch: string }> = {
  cousin: {
    name: "Your brother-in-law",
    emoji: "🧔",
    blurb: "Reorganised his kitchen-cabinet business twice. Works for beer and exposure.",
    fee: 8_000,
    skill: 0.3,
    deck: ["Drew it on a napkin.", "Says hierarchy is 'basically vibes'.", "Asked who the tall one is."],
    pitch: "Hey all, so my brother-in-law had a look at how we're set up and honestly he's got some great ideas...",
  },
  boutique: {
    name: "Two ex-Big Tech guys with a Notion template",
    emoji: "🧑‍💻",
    blurb: "\"We did this at scale.\" Their template has a lot of empty boxes.",
    fee: 40_000,
    skill: 0.6,
    deck: ["47-slide deck, 12 of them about 'pods'.", "Ran a two-day offsite with sticky notes.", "Interviewed half the team over Zoom."],
    pitch: "Team, after a deep-dive with our advisors, we're moving to a pod-based structure that better reflects how we actually work...",
  },
  prestige: {
    name: "A prestige strategy firm",
    emoji: "🎩",
    blurb: "Three partners, eleven analysts, one of them actually read the spreadsheet.",
    fee: 150_000,
    skill: 0.85,
    deck: ["Bound report, embossed logo, 140 pages.", "A 2x2 matrix with your company in every quadrant.", "Interviewed everyone, including the plant."],
    pitch: "Team, following a thorough organisational review with external partners, I'm excited to share our new operating model...",
  },
};
export const CONSULTANT_IDS = Object.keys(CONSULTANTS) as ConsultantId[];

export interface ConsultantJob {
  plan: OrgChange[];
  quality: number; // 0..1, how well they actually did this time
  notes: string[]; // what the deck says (and what it gets wrong)
}

const systemOf = (e: Employee) => SYSTEM_IDS.find((k) => SYSTEMS[k].roles.includes(e.role));

/** Design a new org chart. Every decision is either sensible or, with probability 1 - quality, whatever. */
export function consult(s: GameState, id: ConsultantId, mood: (e: Employee) => number, rnd = Math.random): ConsultantJob {
  const c = CONSULTANTS[id];
  const quality = Math.max(0.05, Math.min(0.98, c.skill + (rnd() - 0.5) * 0.5));
  const good = () => rnd() < quality;
  const pickR = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const people = [...s.employees];
  const notes: string[] = [pickR(c.deck)];
  const plan = new Map<number, OrgChange>(people.map((e) => [e.id, { id: e.id, managerId: null, title: null }]));
  const shuffled = () => [...people].sort(() => rnd() - 0.5);

  // tiny company: everyone reports to you, titles are a vanity
  if (people.length <= CEO_SPAN - 2) {
    for (const e of people) plan.get(e.id)!.title = e.title === "lead" ? "lead" : good() || rnd() < 0.5 ? null : pickR(TITLE_IDS);
    notes.push("Recommends a flat structure. You're a startup, apparently.");
    return finish(s, plan, quality, notes);
  }

  // how many managers: teams of ~6, a sloppy job guesses
  let k = Math.max(1, Math.round(people.length / 6));
  if (!good()) k = Math.max(1, k + pickR([-1, 1, 2]));
  // who manages: happy people who already have a title, or someone who was in the room
  const score = (e: Employee) => mood(e) + (e.title ? TITLES[e.title].rank * 8 : 0) + rnd() * 10;
  const ranked = [...people].sort((a, b) => score(b) - score(a));
  const managers: Employee[] = [];
  const pool = shuffled();
  for (const e of ranked) {
    if (managers.length >= k) break;
    const m = good() ? e : (pool.find((x) => !managers.includes(x)) ?? e);
    if (!managers.includes(m)) managers.push(m);
  }
  // more teams than you can have direct reports: the best few become VPs, the rest leads under them
  const top = managers.slice(0, Math.min(managers.length, 4));
  const mid = managers.slice(top.length);
  for (const m of top) plan.get(m.id)!.title = good() ? (mid.length ? "vp" : "head") : pickR(TITLE_IDS);
  mid.forEach((m, i) => {
    const p = plan.get(m.id)!;
    p.managerId = good() ? top[i % top.length].id : pickR(managers.filter((x) => x !== m)).id;
    p.title = good() ? "lead" : pickR(TITLE_IDS);
  });
  // everyone else joins the team that fits their work and has room
  // a VP's sub-leads count towards their span
  const load = new Map(managers.map((m) => [m.id, mid.filter((x) => plan.get(x.id)!.managerId === m.id).length]));
  for (const e of people) {
    if (managers.includes(e)) continue;
    let to: Employee;
    if (good()) {
      const fit = (m: Employee) => (systemOf(m) === systemOf(e) ? -2 : 0) + load.get(m.id)! + (load.get(m.id)! >= MANAGER_SPAN - 1 ? 50 : 0);
      to = [...managers].sort((a, b) => fit(a) - fit(b))[0];
    } else to = pickR(managers);
    plan.get(e.id)!.managerId = to.id;
    load.set(to.id, load.get(to.id)! + 1);
    // titles nobody needs: a good consultant softens the blow, a bad one hands them out
    plan.get(e.id)!.title = e.title ? (good() ? "lead" : null) : good() ? null : rnd() < 0.3 ? pickR(TITLE_IDS) : null;
  }

  // the deck's highlights, in the consultants' own words
  const flat = top.length;
  notes.push(`${managers.length} team${managers.length === 1 ? "" : "s"}, ${flat} reporting to you${mid.length ? `, ${mid.length} more one level down` : ""}.`);
  const miserable = managers.filter((m) => mood(m) < 40);
  if (miserable.length) notes.push(`Put ${miserable.map((m) => m.name.split(" ")[0]).join(", ")} in charge. Did not ask how they're doing.`);
  const vanity = [...plan.values()].filter((p) => p.title && p.title !== "lead" && !managers.some((m) => m.id === p.id));
  if (vanity.length) notes.push(`Hands out ${vanity.length} big title${vanity.length === 1 ? "" : "s"} to people with no team. "Retention."`);
  if (quality >= 0.8) notes.push("Honestly? It's pretty good.");
  else if (quality < 0.35) notes.push("Several boxes on the chart are labelled 'TBD'.");
  return finish(s, plan, quality, notes);
}

function finish(s: GameState, plan: Map<number, OrgChange>, quality: number, notes: string[]): ConsultantJob {
  const same = s.employees.every((e) => {
    const p = plan.get(e.id)!;
    return (managerOf(s, e)?.id ?? null) === p.managerId && (e.title ?? null) === p.title;
  });
  if (same) notes.push("Recommends changing nothing. Invoice attached.");
  return { plan: [...plan.values()], quality, notes };
}

/** What the team suspects about who really drew the chart. */
export const consultantLine = (id: ConsultantId, job: ConsultantJob) =>
  `Designed by outside consultants: ${CONSULTANTS[id].name} (paid ${CONSULTANTS[id].fee}). Their work this time was ${job.quality >= 0.75 ? "genuinely solid" : job.quality >= 0.45 ? "mixed" : "sloppy"}. Staff can tell an outsider drew it.`;

