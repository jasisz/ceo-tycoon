// CEO lifestyle: things that look great on LinkedIn. Pay with your own savings (FIRE slips away) or
// put it on the company card (suspicion, receipts, auditors). The LLM knows what you own.

import type { GameState } from "./state";

export type Payer = "self" | "company";

export interface LifestyleItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  upkeep?: number; // per quarter, from whoever paid
  hype: number; // one-off
  reputation: number; // one-off; helps you land the next CEO gig
  morale: number; // one-off; the team sees it
  perQ?: { hype?: number; morale?: number; reputation?: number }; // every quarter while you own it
  decisions?: number; // extra decisions per quarter
  blurb: string;
  gossip: string; // what the LLM hears
}

export const LIFESTYLE: LifestyleItem[] = [
  { id: "vest", name: "Fleece vest with the logo", emoji: "🦺", cost: 400, hype: 2, reputation: 0, morale: 0, perQ: { hype: 1 }, blurb: "Now you look like someone who could raise a Series B.", gossip: "a logo fleece vest worn to every meeting" },
  { id: "watch", name: "A watch that costs more than a junior's salary", emoji: "⌚", cost: 38_000, hype: 2, reputation: 3, morale: -3, perQ: { hype: 1, morale: -1 }, blurb: "You check the time a lot more now. Especially in 1:1s.", gossip: "a $38k watch" },
  { id: "tesla", name: "Tesla, the fast one", emoji: "🚗", cost: 110_000, hype: 4, reputation: 4, morale: -3, perQ: { hype: 1, morale: -1 }, blurb: "Ludicrous mode. Mostly used in the office parking lot.", gossip: "a Tesla Plaid parked in the CEO spot" },
  { id: "lambo", name: "Lamborghini Urus", emoji: "🏎️", cost: 260_000, hype: 8, reputation: 6, morale: -10, perQ: { hype: 3, morale: -3 }, blurb: "Bright yellow. Parked across two spots, right by the window.", gossip: "a yellow Lamborghini parked across two spots" },
  { id: "retreat", name: "Ayahuasca retreat in Peru", emoji: "🧘", cost: 18_000, hype: 5, reputation: 1, morale: -2, blurb: "You come back with a 'new vision' and a vocabulary nobody understands.", gossip: "came back from an ayahuasca retreat with a new vision" },
  { id: "ted", name: "TEDx talk (ghostwritten)", emoji: "🎤", cost: 25_000, hype: 8, reputation: 5, morale: -1, perQ: { hype: 1 }, blurb: "'Failing Forward: What Startups Taught Me About Breathing.' 2M views.", gossip: "a viral TEDx talk about failing forward" },
  { id: "ibiza", name: "'Strategy offsite' in Ibiza", emoji: "🏝️", cost: 85_000, hype: 4, reputation: 1, morale: -8, blurb: "Just the leadership team. Which is you. The Instagram stories were public.", gossip: "a solo 'strategy offsite' in Ibiza" },
  { id: "jet", name: "Private jet membership", emoji: "🛩️", cost: 150_000, upkeep: 40_000, hype: 5, reputation: 4, morale: -4, perQ: { hype: 2, morale: -2 }, decisions: 1, blurb: "Two cities a day. One extra decision every quarter. $40k a quarter in fuel and smugness.", gossip: "a private jet membership" },
  { id: "penthouse", name: "Penthouse with a view", emoji: "🏙️", cost: 30_000, upkeep: 30_000, hype: 2, reputation: 5, morale: -3, perQ: { reputation: 2, hype: 1, morale: -1 }, blurb: "Floor-to-ceiling windows, networking parties every Friday. Reputation grows; so does the bill.", gossip: "a penthouse where the CEO throws networking parties" },
];

/** Sum of every owned item's per-quarter effects, and extra decisions. */
export function lifestyleEffects(s: GameState) {
  const fx = { hype: 0, morale: 0, reputation: 0, decisions: 0 };
  for (const o of s.lifestyle) {
    const it = lifestyleById(o.id);
    if (!it) continue;
    fx.hype += it.perQ?.hype ?? 0;
    fx.morale += it.perQ?.morale ?? 0;
    fx.reputation += it.perQ?.reputation ?? 0;
    fx.decisions += it.decisions ?? 0;
  }
  return fx;
}

export const lifestyleById = (id: string) => LIFESTYLE.find((x) => x.id === id);

export interface Owned {
  id: string;
  quarter: number;
  payer: Payer;
}

/** Putting it on the company card: suspicion scales with the receipt, more if a CFO reads them. */
export const expenseSuspicion = (s: GameState, it: LifestyleItem) =>
  Math.min(15, Math.max(2, Math.ceil(it.cost / 20_000))) + (s.cfo && s.employees.some((e) => e.name === s.cfo) ? 4 : 0);

export function describeLifestyle(s: GameState) {
  if (!s.lifestyle.length) return "";
  return `The CEO's lifestyle: ${s.lifestyle
    .map((o) => {
      const it = lifestyleById(o.id);
      return it ? `${it.gossip} (${o.payer === "company" ? "expensed to the company" : "paid personally"})` : "";
    })
    .filter(Boolean)
    .join("; ")}.`;
}
