// The board of directors: who sits on it, what they want, and what happens when they outvote you.
// The LLM decides how each member votes after hearing the CEO; this module decides what a passed
// motion actually does.

import { addKpi, compactDesks, fmt, log, makeEmployee, quarterlyCosts, quarterlyRevenue, remember, removeEmployees, runwayQuarters, valuation, type CastMember, type GameState } from "./state";

export const BOARD_EVERY = 4; // quarters between scheduled board meetings

const INDEPENDENT: CastMember = {
  name: "Margaret Holloway",
  role: "independent board director, retired Big Four audit partner who reads every footnote",
  history: [],
};

export const isBoardSeat = (c: CastMember) => /sits on your board/i.test(c.role);

/** Everyone who votes except you. Chad chairs; Margaret is independent; fund partners came with your term sheets. */
export function boardMembers(s: GameState): CastMember[] {
  if (!s.cast.some((c) => c.name === INDEPENDENT.name)) s.cast.push(structuredClone(INDEPENDENT));
  const chair = s.cast.find((c) => c.name === "Chad Brennan");
  const indie = s.cast.find((c) => c.name === INDEPENDENT.name)!;
  return [...(chair ? [chair] : []), indie, ...s.cast.filter(isBoardSeat)];
}

export type MotionId = "no_confidence" | "cfo" | "cut_staff" | "ceo_pay" | "sell_perks" | "growth";

export interface Motion {
  id: MotionId;
  title: string;
  text: string; // what it does, in plain words
}

/** The board brings whatever worries it most. */
export function pickMotion(s: GameState): Motion {
  const burn = quarterlyCosts(s) - quarterlyRevenue(s);
  const n = Math.max(1, Math.round(s.employees.length * 0.2));
  if (s.suspicion >= 60 || (s.hype < 20 && s.quarter > 4))
    return { id: "no_confidence", title: "Vote of no confidence in the CEO", text: "If it passes, you are removed as CEO, effective immediately." };
  if (s.suspicion >= 30 && !s.cfo)
    return { id: "cfo", title: "Appoint an independent CFO", text: "A CFO chosen by the board ($75k/q) who reports on every outgoing payment. Zug gets harder." };
  if (runwayQuarters(s) < 3 && burn > 0 && s.employees.length > 3)
    return { id: "cut_staff", title: `Cut ${n} people to extend runway`, text: `${n} people are laid off by the board's list, not yours.` };
  if (s.upgrades.length >= 3 && burn > 0)
    return { id: "sell_perks", title: "Sell the office perks", text: "Every perk goes on eBay. The team will know who wanted to keep the beer fridge." };
  if (burn > 0 && s.hype < 50)
    return { id: "ceo_pay", title: "Freeze the CEO's salary for a year", text: "Your salary is $0 for the next 4 quarters." };
  return { id: "growth", title: "Double headcount within 3 quarters", text: "The board writes it down as a KPI. They will check." };
}

/** Chair breaks ties. You always vote against. */
export function tally(s: GameState, votes: { name: string; vote: "yes" | "no" }[]) {
  const members = boardMembers(s);
  const byName = (m: CastMember) => votes.find((v) => v.name.toLowerCase().includes(m.name.split(" ")[0].toLowerCase()))?.vote ?? "yes";
  const cast = members.map((m) => ({ name: m.name, vote: byName(m) }));
  const yes = cast.filter((v) => v.vote === "yes").length;
  const no = cast.length - yes + 1; // + the CEO
  const passed = yes > no || (yes === no && cast[0]?.vote === "yes");
  return { cast, yes, no, passed };
}

/** What a passed motion does. Returns a line for the result screen. */
export function enactMotion(s: GameState, m: Motion): string {
  switch (m.id) {
    case "no_confidence":
      s.reputation = Math.max(0, s.reputation - 15);
      s.over = {
        win: false,
        canContinue: s.reputation >= 20,
        title: "Removed by your own board",
        text: `The board voted you out of ${s.company}. Security has your badge before you reach the elevator. ${s.reputation >= 20 ? "Someone will still hire you; boards love a CEO who 'has been through it'." : "Nobody will hire you now."}`,
      };
      return "You are no longer the CEO.";
    case "cfo": {
      s.cfo = "Gunther Absalon";
      const e = makeEmployee(-1, s.quarter);
      Object.assign(e, {
        name: s.cfo,
        role: "Finance",
        quirk: "reconciles the books for fun and asks follow-up questions about invoices",
        moodOffset: 10,
        salary: 75_000,
        title: "chief",
        managerId: null,
      });
      remember(e, s.quarter, "Appointed CFO by the board, over the CEO's objection. Reports every outgoing payment to the board.");
      s.employees.push(e);
      compactDesks(s);
      log(s, `The board appointed ${s.cfo} as CFO. He has already asked about Zug.`);
      return `${s.cfo} is your new CFO. Every transfer to Zug is now more suspicious.`;
    }
    case "cut_staff": {
      const gone = removeEmployees(s, Math.max(1, Math.round(s.employees.length * 0.2)), "laid off");
      s.morale = Math.max(0, s.morale - 12);
      return `The board laid off ${gone.map((g) => g.name).join(", ")}. Everyone knows you couldn't stop it.`;
    }
    case "sell_perks": {
      const n = s.upgrades.length;
      s.upgrades = [];
      s.upgradeBought = {};
      s.morale = Math.max(0, s.morale - 8);
      return `${n} perks sold for scrap. The beer fridge went first.`;
    }
    case "ceo_pay":
      s.payFrozenUntil = s.quarter + 4;
      return `Your salary is $0 until Q${s.quarter + 4}. FIRE just got further away.`;
    case "growth":
      addKpi(s, "The board's growth plan: double headcount", "headcount", 2, 3);
      return `Board KPI: ${s.employees.length * 2} people by Q${s.quarter + 3} (valuation now ${fmt(valuation(s))}).`;
  }
}

/** Everyone on the board remembers how the vote went. */
export function rememberVote(s: GameState, m: Motion, passed: boolean, cast: { name: string; vote: string }[]) {
  for (const c of cast) {
    const member = s.cast.find((x) => x.name === c.name);
    if (member) remember(member, s.quarter, `Voted ${c.vote} on "${m.title}" at ${s.company}; it ${passed ? "passed over the CEO's objection" : "failed"}.`);
  }
}
