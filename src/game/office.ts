// Office tiers and purchasable upgrades. Pure data; the economy in state.ts reads it.

export type OfficeTier = "garage" | "cowork" | "openspace" | "campus" | "remote";

export interface OfficeSpec {
  id: OfficeTier;
  name: string;
  emoji: string;
  desks: number; // Infinity for remote
  rent: number; // per quarter
  moveCost: number; // one-off
  moralePerQ: number;
  hypePerQ: number;
  upgradeSlots: number;
  minValuation: number; // landlords check your deck
  rank: number; // for "upgrade" vs "downsize" wording
  blurb: string;
}

export const OFFICES: Record<OfficeTier, OfficeSpec> = {
  garage: {
    id: "garage",
    name: "Garage",
    emoji: "🏚️",
    desks: 4,
    rent: 6_000,
    moveCost: 5_000,
    moralePerQ: -2,
    hypePerQ: 0,
    upgradeSlots: 2,
    minValuation: 0,
    rank: 0,
    blurb: "Your aunt's garage. Folding tables, one extension cord, legendary origin story.",
  },
  cowork: {
    id: "cowork",
    name: "Coworking space",
    emoji: "🪴",
    desks: 8,
    rent: 30_000,
    moveCost: 20_000,
    moralePerQ: -1,
    hypePerQ: 0,
    upgradeSlots: 3,
    minValuation: 0,
    rank: 1,
    blurb: "Kombucha on tap, strangers on your desks, a crypto startup on every side.",
  },
  openspace: {
    id: "openspace",
    name: "Open-space office",
    emoji: "🏢",
    desks: 14,
    rent: 60_000,
    moveCost: 120_000,
    moralePerQ: 0,
    hypePerQ: 1,
    upgradeSlots: 6,
    minValuation: 8_000_000,
    rank: 2,
    blurb: "A real office. Glass walls, a ping-pong table nobody uses. Can lease another floor.",
  },
  campus: {
    id: "campus",
    name: "Glass campus",
    emoji: "🏙️",
    desks: 32,
    rent: 220_000,
    moveCost: 500_000,
    moralePerQ: 2,
    hypePerQ: 3,
    upgradeSlots: 10,
    minValuation: 40_000_000,
    rank: 3,
    blurb: "Slides between floors, an auditorium for all-hands, a view your burn rate can't afford.",
  },
  remote: {
    id: "remote",
    name: "Remote-first",
    emoji: "🏠",
    desks: Infinity,
    rent: 0,
    moveCost: 10_000,
    moralePerQ: -1,
    hypePerQ: -1,
    upgradeSlots: 3,
    minValuation: 0,
    rank: -1,
    blurb: "No office. Everyone is a Zoom tile. Cheap, quiet, and nobody knows if you're working.",
  },
};

export const FLOOR_DESKS = 10;
export const FLOOR_RENT = 45_000;
export const FLOOR_COST = 150_000;
export const MAX_HEADCOUNT = 40;
export const HOT_DESK_OVERFLOW = 6; // how many people you can cram in beyond desks

export interface UpgradeSpec {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  perHead?: boolean; // cost multiplied by headcount
  morale: number; // per quarter
  hype: number; // per quarter
  revenue: number; // revenue multiplier delta, e.g. -0.04
  upkeep: number; // per quarter (per head if perHead): beans, vets, licences, the robot's service contract
  remote: "no" | "yes" | "only";
  blurb: string;
  gossip: string; // fed to the LLM so office chatter can mention it
}

export const UPGRADES: UpgradeSpec[] = [
  { id: "espresso", name: "Premium espresso machine", emoji: "☕", cost: 15_000, morale: 1, hype: 0, revenue: 0.02, upkeep: 2_000, remote: "no", blurb: "Italian. Has an app. Requires a 40-minute onboarding.", gossip: "a $15k espresso machine with its own app" },
  { id: "climbing", name: "Climbing wall", emoji: "🧗", cost: 60_000, morale: 0, hype: 2, revenue: 0, upkeep: 6_000, remote: "no", blurb: "Looks amazing on the careers page. Used once, by a recruiter.", gossip: "a climbing wall nobody uses" },
  { id: "dog2", name: "Second office dog", emoji: "🐕", cost: 3_000, morale: 2, hype: 0, revenue: -0.01, upkeep: 1_500, remote: "no", blurb: "Biscuit gets a colleague. Productivity drops, happiness spikes.", gossip: "a second office dog" },
  { id: "quietroom", name: "Quiet room", emoji: "🔕", cost: 25_000, morale: 1, hype: 0, revenue: 0, upkeep: 500, remote: "no", blurb: "Permanently occupied by someone napping since March.", gossip: "a quiet room that is always occupied" },
  { id: "beerfridge", name: "Beer fridge", emoji: "🍺", cost: 8_000, morale: 2, hype: 0, revenue: -0.04, upkeep: 4_000, remote: "no", blurb: "Fridays now start on Thursday.", gossip: "a beer fridge that is somehow always empty" },
  { id: "ledwall", name: "Giant valuation LED wall", emoji: "📈", cost: 50_000, morale: -1, hype: 3, revenue: 0, upkeep: 5_000, remote: "no", blurb: "Shows the company valuation in real time. Investors love it. Employees find it ominous.", gossip: "a giant LED wall showing the valuation" },
  { id: "plantwall", name: "Living plant wall", emoji: "🌿", cost: 20_000, morale: 1, hype: 1, revenue: 0, upkeep: 3_000, remote: "no", blurb: "Very Instagrammable. Waters itself. Mostly.", gossip: "an Instagrammable plant wall" },
  { id: "robot", name: "AI receptionist robot", emoji: "🤖", cost: 80_000, morale: -1, hype: 4, revenue: 0, upkeep: 12_000, remote: "no", blurb: "Greets visitors, records everything, reports to nobody (allegedly).", gossip: "an AI receptionist robot that might be recording everyone" },
  { id: "chairs", name: "Ergonomic chairs", emoji: "🪑", cost: 1_200, perHead: true, morale: 1, hype: 0, revenue: 0.02, upkeep: 0, remote: "yes", blurb: "Finally. Backs everywhere rejoice.", gossip: "new ergonomic chairs" },
  { id: "headphones", name: "Noise-cancelling headphones", emoji: "🎧", cost: 350, perHead: true, morale: 1, hype: 0, revenue: 0.01, upkeep: 0, remote: "yes", blurb: "Now nobody can hear the CEO. Morale up.", gossip: "noise-cancelling headphones so nobody hears the CEO" },
  { id: "stipend", name: "Home office stipend", emoji: "🏡", cost: 1_000, perHead: true, morale: 2, hype: 0, revenue: 0, upkeep: 250, remote: "only", blurb: "Spent mostly on ring lights and a better webcam to look busy.", gossip: "a home office stipend spent on ring lights" },
  { id: "zoombg", name: "Branded Zoom backgrounds", emoji: "🖼️", cost: 2_000, morale: -1, hype: 2, revenue: 0, upkeep: 1_000, remote: "only", blurb: "Mandatory. Everyone is now on a fake beach with your logo.", gossip: "mandatory branded Zoom backgrounds" },
];

/** Quarters a perk feels special. After that people stop noticing the good parts (never the bad ones). */
export const NOVELTY_QUARTERS = 3;

export const upgradeById = (id: string) => UPGRADES.find((u) => u.id === id);

const cl = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(v) || 0));

/** An LLM-invented perk, with sane numbers: the more it does, the more it costs. */
export function clampUpgrade(x: Partial<UpgradeSpec> & { name: string }, i: number, remote: boolean): UpgradeSpec {
  const perHead = !!x.perHead;
  const cost = Math.round(cl(x.cost, perHead ? 100 : 1_000, perHead ? 3_000 : 150_000));
  const budget = 1 + (perHead ? cost / 600 : cost / 20_000); // how much upside the price buys
  let morale = Math.round(cl(x.morale, -2, 3));
  let hype = Math.round(cl(x.hype, -1, 4));
  let revenue = Math.round(cl(x.revenue, -0.05, 0.04) * 100) / 100;
  const upside = Math.max(0, morale) + Math.max(0, hype) + Math.max(0, revenue) * 50;
  if (upside > budget) {
    const k = budget / upside;
    morale = morale > 0 ? Math.floor(morale * k) : morale;
    hype = hype > 0 ? Math.floor(hype * k) : hype;
    revenue = revenue > 0 ? Math.floor(revenue * k * 100) / 100 : revenue;
  }
  return {
    id: `c${Date.now().toString(36)}${i}`,
    name: String(x.name).slice(0, 50),
    emoji: String(x.emoji || "✨").slice(0, 4),
    cost,
    perHead: perHead || undefined,
    morale,
    hype,
    revenue,
    upkeep: Math.round(cl(x.upkeep, 0, perHead ? 600 : 15_000)),
    remote: remote ? "only" : "no",
    blurb: String(x.blurb ?? "").slice(0, 160),
    gossip: String(x.gossip ?? x.name).slice(0, 100),
  };
}
