// Customers and AI. Deals are the one lever on revenue that isn't headcount: the LLM invents the
// prospects and plays the buyer, the engine sets the price, books the contract and decides who churns.
// AI is a budget (tools for the people you have) and a temptation (agents instead of people).

import type { GameState, SystemId } from "./state";

export interface Deal {
  client: string;
  value: number; // per quarter
  signed: number;
  until: number; // last quarter it pays
}

export interface Prospect {
  client: string;
  contact: string; // "Name, title"
  need: string;
  demand: string; // what they'll ask for to sign
  red_flag: string;
  budget: number; // per quarter
  quarters: number;
}

export const PRICING = [
  { label: "Discount", mult: 0.7 },
  { label: "List price", mult: 1 },
  { label: "Premium", mult: 1.4 },
];

export const dealValue = (p: Prospect, mult: number) => Math.round((p.budget * mult) / 1000) * 1000;

export const activeDeals = (s: GameState) => (s.deals ?? []).filter((d) => d.until >= s.quarter);
export const dealRevenue = (s: GameState) => activeDeals(s).reduce((a, d) => a + d.value, 0);

/** Customers someone actually looks after: two per salesperson, plus the two the CEO answers personally. */
export const accountCapacity = (s: GameState) => 2 + 2 * s.employees.filter((e) => e.role === "Sales Rep" || e.role === "Growth Hacker").length;

/** How likely a customer is to walk this quarter, given how the product is holding up and who answers their emails. */
export function churnRisk(s: GameState) {
  const h = s.systems;
  const neglected = Math.max(0, activeDeals(s).length - accountCapacity(s));
  return (h.product.health < 40 ? 0.2 : 0) + (h.infra.health < 30 ? 0.2 : 0) + (h.sales.owner == null ? 0.1 : 0) + (h.billing.health < 30 ? 0.1 : 0) + neglected * 0.08;
}

/** Chance an expiring contract renews: a healthy product and someone who answers the customer's emails. */
export function renewChance(s: GameState) {
  const h = s.systems;
  return Math.min(0.85, 0.2 + h.product.health / 200 + (h.sales.health >= 50 ? 0.15 : 0));
}

// ---------- AI ----------

export const AI_TIERS = [
  { spend: 0, label: "Nothing", blurb: "People paste customer data into free chatbots on their phones.", boost: 0 },
  { spend: 500, label: "Basic seats", blurb: "Everyone gets a chatbot. Most use it for emails.", boost: 0.04 },
  { spend: 2_000, label: "Pro everything", blurb: "Copilots, coding agents, the works. Some of it even helps. Investors like the sound of it.", boost: 0.1 },
  { spend: 8_000, label: "Unlimited GPUs", blurb: "Anyone can spin up anything. Someone is fine-tuning a model on the Slack archive.", boost: 0.13 },
];

export const aiTier = (s: GameState) => AI_TIERS[s.aiTier ?? 0];

export interface Agent {
  id: number;
  name: string;
  role: string;
  replaced: string; // who it replaced
  since: number;
}

/** Tokens aren't free. Per agent, per quarter. */
export const AGENT_COST = 10_000;

/** An agent does 60% of a person's job, more with good tooling around it. No bad days, no good ones. */
export const agentOutput = (s: GameState) => 0.6 + aiTier(s).boost * 2;

export const agentIncidentChance = (s: GameState) => ((s.aiTier ?? 0) >= 2 ? 0.1 : 0.16);

export const AGENT_INCIDENTS: { text: string; cash?: number; hype?: number; suspicion?: number; system?: SystemId; churn?: boolean }[] = [
  { text: "promised a customer a lifetime refund. Legal says it's binding.", cash: -40_000 },
  { text: "replied-all to the entire CRM with its own system prompt.", hype: -5 },
  { text: "dropped a production table, then wrote a genuinely moving apology.", system: "infra" },
  { text: "announced a partnership with a company that doesn't exist. On LinkedIn. It has 4,000 likes.", hype: 4, suspicion: 4 },
  { text: "invoiced a customer for 'emotional labour'.", system: "billing" },
  { text: "told your biggest customer their setup was 'cooked' and recommended a competitor.", churn: true },
  { text: "approved its own expense report for 40,000 GPU hours.", cash: -25_000 },
  { text: "redesigned the onboarding flow overnight. Nobody asked. Nobody can log in.", system: "product" },
];

export function describeAi(s: GameState) {
  const t = aiTier(s);
  const agents = s.agents ?? [];
  return [
    `AI tools budget: ${t.spend ? `$${t.spend} per person per quarter (${t.label})` : "none (people use free chatbots on their phones)"}.`,
    agents.length ? `AI agents doing former employees' jobs: ${agents.map((a) => `${a.name} (replaced ${a.replaced}, ${a.role}, since Q${a.since})`).join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function describeDeals(s: GameState) {
  const d = activeDeals(s);
  return d.length ? `Customers under contract: ${d.map((x) => `${x.client} ($${Math.round(x.value / 1000)}k/q until Q${x.until})`).join("; ")}.` : "No customers under contract yet; revenue is whatever the team scrapes together.";
}
