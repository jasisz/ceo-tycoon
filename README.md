# CEO Tycoon

Satirical isometric tycoon where you're a C-level exec whose real goal is FIRE — via an honest IPO
or by quietly wiring "consulting fees" to Zug. An LLM sits inside the game engine as the game master.

![CEO Tycoon gameplay](docs/demo.gif)

## Run

```bash
cp .env.example .env   # put your ANTHROPIC_API_KEY there
npm install
npm run dev
```

Without a key the game still runs with a dumb heuristic "mock GM". Progress autosaves to localStorage.

## Offices

You start in your aunt's garage, paying yourself ramen money. Garage → coworking → open space (+ east wing) → glass campus, or go remote-first and run the
company as a Zoom grid. Hire beyond your desks and people hot-desk on beanbags (morale tanks).
The office shop sells perks with trade-offs (climbing wall, beer fridge, AI receptionist, valuation
LED wall...), all visible in the office and known to the LLM's office gossip. Perks cost upkeep
every quarter, and the novelty wears off: after a few quarters nobody notices the upside (the
downsides stay).

## Things come back to bite you

- **Company systems** (infra, billing, product, sales) are each understood by exactly one person, who
  is paid accordingly. Fire them to save money and the system rots; below 30 it's a crisis and the
  board calls you in to explain yourself (in writing, judged by the LLM).
- **People remember.** Every employee keeps a history of promises, broken promises, 1:1s and who got
  fired. The LLM reads it in every conversation.
- **Alumni** hold grudges, post Glassdoor reviews, join competitors, and can be rehired as contractors
  at 3x — if your phone call convinces them. Whoever processed your Zug invoices may blow the whistle.
- **Investor KPIs**: numbers you throw around in a pitch get written down and checked later.
- **Term sheets**: you pick the ask and the valuation (fair, optimistic, delusional) and can sweeten
  it with a board seat, a 2x liquidation preference or a personal guarantee. The LLM plays the fund:
  accept, counter or pass. The engine enforces what you signed — the preference eats your IPO, the
  guarantee eats your savings, the board member sticks around.
- **Media**: podcasts, a journalist who asks about whatever she's heard (Zug included), LinkedIn
  posts, paid features. The team reads it too.

## How the LLM is wired in

- `server/llm.ts` — game master: judges free-text actions (all-hands, investor pitch, 1:1s, custom
  event responses), invents quarterly events with choices, writes office gossip.
  Uses structured outputs; every number it returns is clamped.
- `src/game/state.ts` — rule-based simulation (economy, promises, audits, win/lose). The LLM can
  only propose deltas; this owns the numbers.
- `src/scene/OfficeScene.ts` — Phaser isometric office drawn with code (no assets).
- `vite.config.ts` — mounts `/api/*` on the dev server so the key never reaches the browser.

Default game master model is `claude-sonnet-5-5`; override with `CEO_MODEL` in `.env`.

## License

MIT
