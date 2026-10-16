// Isometric office drawn entirely with Phaser Graphics - no external assets.
// The canvas renders at native device resolution; the camera zooms the world
// to fit, so vector shapes stay crisp at any size. Each office tier has its own
// layout (navigation data) and decoration; "remote" is drawn as a Zoom call.
import Phaser from "phaser";
import type { Employee } from "../game/state";
import type { OfficeTier } from "../game/office";
import { titleOf } from "../game/org";

const TW = 64; // tile width
const TH = 32; // tile height
const WALL = 78;
const INK = 0x2b2d42; // cartoon outline colour

const SHIRTS = [0xef476f, 0x118ab2, 0xffd166, 0x06d6a0, 0x8338ec, 0xff8c42, 0x3a86ff, 0xe63946, 0x2a9d8f, 0xf15bb5];
const PANTS = [0x3d405b, 0x264653, 0x5c4d7d, 0x463f3a, 0x1d3557];
const SKIN = [0xffd8b1, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const HAIR = [0x2b2118, 0x5a3825, 0xd4a017, 0xb5523b, 0x1a1a1a, 0x9e9e9e, 0xff6fb5, 0x4cc9f0];
const HAIRSTYLES = ["bowl", "spiky", "bun", "bald", "long", "mohawk", "curly"] as const;
const ACCESSORIES = ["none", "none", "glasses", "headphones", "beard", "cap", "none", "glasses"] as const;
const LOW_EMOTES = ["💢", "😤", "🙄", "💀", "😩", "🫠"];
const MID_EMOTES = ["☕", "🤔", "📊", "🫡", "💬"];
const HIGH_EMOTES = ["✨", "🎉", "💪", "🚀", "😎"];

type HairStyle = (typeof HAIRSTYLES)[number];
type Accessory = (typeof ACCESSORIES)[number];

interface Pt {
  x: number;
  y: number;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Navigation data for one office. All coordinates are grid units. */
interface Layout {
  GW: number;
  GH: number;
  desks: Pt[]; // desk origin; desk footprint is 1.1 x 0.6, seat in front
  aisles: number[];
  corridors: number[];
  deskArea: Rect;
  door: Pt;
  coffee: Pt;
  hangouts: Pt[];
  gather: Rect;
  investorSpots: Pt[];
  overflow: Pt[]; // where hot-deskers hang out
  ceo: Pt;
  safe: Pt;
  upgradeSlots: Pt[];
}

export interface OfficeView {
  tier: OfficeTier;
  floors: number;
  upgrades: string[];
  headcount: number;
  custom?: { id: string; emoji: string; name: string; blurb: string }[]; // LLM-invented perks: drawn as a prop with their emoji
}

interface Person {
  data: Employee;
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  legL: Phaser.GameObjects.Graphics;
  legR: Phaser.GameObjects.Graphics;
  face: Phaser.GameObjects.Graphics;
  eyes: Phaser.GameObjects.Graphics;
  g: Pt;
  walking: boolean;
  seated: boolean;
  phase: number;
  timer?: Phaser.Time.TimerEvent;
  lastMood: number;
  camOff?: Phaser.GameObjects.Container; // remote only
  badge: Phaser.GameObjects.Text;
}

interface Bubble {
  target: Phaser.GameObjects.Container;
  box: Phaser.GameObjects.Container;
  offset: number;
}

interface Dog {
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  g: Pt;
  walking: boolean;
}

export interface OfficeCallbacks {
  onEmployeeClick: (id: number) => void;
  onCeoClick: () => void;
  getMood: (id: number) => number;
  getValuation: () => string;
  getBadge: (id: number) => string; // emojis of the systems this person owns
  inCrisis: () => boolean;
  onReady: (scene: OfficeScene) => void;
}

// ---------- layouts ----------

const range = (from: number, n: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);
const grid = (xs: number[], ys: number[]): Pt[] => ys.flatMap((y) => xs.map((x) => ({ x, y })));

function layoutFor(tier: OfficeTier, floors: number): Layout {
  switch (tier) {
    case "garage":
      return {
        GW: 9,
        GH: 7,
        desks: grid([2.2, 4.2], [2, 4.2]),
        aisles: [1.6, 3.75, 5.8],
        corridors: [1.2, 5.9],
        deskArea: { x0: 1.9, x1: 5.6, y0: 1.8, y1: 5.3 },
        door: { x: 8.4, y: 6.5 },
        coffee: { x: 7.2, y: 1.3 },
        hangouts: [{ x: 7.6, y: 1.6 }, { x: 6.6, y: 1.5 }, { x: 1.0, y: 6.2 }, { x: 4.8, y: 6.3 }],
        gather: { x0: 1.2, y0: 5.6, x1: 5.8, y1: 6.6 },
        investorSpots: [{ x: 2.0, y: 6.3 }, { x: 3.0, y: 6.5 }, { x: 4.0, y: 6.3 }],
        overflow: [{ x: 1.0, y: 1.0 }, { x: 1.4, y: 0.9 }, { x: 0.9, y: 3.6 }, { x: 0.9, y: 4.9 }, { x: 6.2, y: 5.8 }, { x: 5.6, y: 1.2 }],
        ceo: { x: 7.5, y: 5.4 },
        safe: { x: 8.25, y: 4.3 },
        upgradeSlots: [{ x: 0.3, y: 5.6 }, { x: 5.9, y: 6.4 }],
      };
    case "cowork":
      return {
        GW: 12,
        GH: 8,
        desks: grid([3.5, 5.5, 7.5, 9.5], [2, 4]),
        aisles: [3.0, 5.05, 7.05, 9.05, 10.9],
        corridors: [1.2, 7.3],
        deskArea: { x0: 3.2, x1: 10.8, y0: 1.8, y1: 6.9 },
        door: { x: 11.5, y: 7.5 },
        coffee: { x: 10.9, y: 1.4 },
        hangouts: [{ x: 10.4, y: 1.5 }, { x: 11.3, y: 1.7 }, { x: 1.5, y: 3.3 }, { x: 2.4, y: 4.6 }, { x: 11.1, y: 4.6 }],
        gather: { x0: 3.2, y0: 7.0, x1: 10.2, y1: 7.7 },
        investorSpots: [{ x: 0.8, y: 0.9 }, { x: 1.7, y: 0.8 }, { x: 2.2, y: 1.7 }],
        overflow: [{ x: 1.6, y: 3.2 }, { x: 2.4, y: 3.6 }, { x: 11.2, y: 3.4 }, { x: 11.3, y: 5.4 }, { x: 2.5, y: 5.3 }, { x: 11.0, y: 6.6 }],
        ceo: { x: 1.6, y: 6.9 },
        safe: { x: 0.3, y: 7.1 },
        upgradeSlots: [{ x: 11.3, y: 2.6 }, { x: 0.3, y: 3.0 }, { x: 11.3, y: 6.1 }],
      };
    case "campus":
      return {
        GW: 22,
        GH: 14,
        desks: grid(range(6, 8, 2), [4, 6, 8, 10]),
        aisles: [5.5, 7.55, 9.55, 11.55, 13.55, 15.55, 17.55, 19.55, 21.5],
        corridors: [2.9, 11.8],
        deskArea: { x0: 5.4, x1: 21.6, y0: 3.4, y1: 11.2 },
        door: { x: 21.5, y: 13.5 },
        coffee: { x: 19.2, y: 1.6 },
        hangouts: [{ x: 16, y: 1.7 }, { x: 17.5, y: 1.9 }, { x: 19.5, y: 1.8 }, { x: 8.5, y: 2.2 }, { x: 11, y: 2.4 }, { x: 3.5, y: 6.2 }],
        gather: { x0: 1.0, y0: 5.4, x1: 4.6, y1: 8.8 },
        investorSpots: [{ x: 1.2, y: 1.3 }, { x: 2.4, y: 1.1 }, { x: 3.6, y: 1.6 }],
        overflow: [{ x: 6, y: 12.6 }, { x: 9, y: 12.7 }, { x: 12, y: 12.5 }, { x: 15, y: 12.7 }, { x: 18, y: 12.6 }, { x: 8, y: 2.0 }],
        ceo: { x: 3.2, y: 12.6 },
        safe: { x: 0.35, y: 12.9 },
        upgradeSlots: [...range(6.4, 8, 2).map((x) => ({ x, y: 13.1 })), { x: 20.6, y: 1.5 }, { x: 13.4, y: 2.0 }],
      };
    case "openspace":
    default: {
      const wing = floors > 0;
      const GW = wing ? 20 : 14;
      const desks = [
        ...grid([5, 7, 9], [2, 4, 6, 8]),
        { x: 11.5, y: 6 },
        { x: 11.5, y: 8 },
        ...(wing ? [...grid([14.6, 16.6], [2, 4, 6, 8]), { x: 18.5, y: 4 }, { x: 18.5, y: 6 }] : []),
      ];
      return {
        GW,
        GH: 10,
        desks,
        aisles: [4.5, 6.55, 8.55, 10.75, ...(wing ? [13.9, 16.15, 18.1, 19.75] : [])],
        corridors: [1.35, 9.4],
        deskArea: { x0: 4.3, x1: wing ? 19.8 : 12.8, y0: 1.7, y1: 9.1 },
        door: { x: GW - 0.6, y: 9.5 },
        coffee: { x: 12.45, y: 1.3 },
        hangouts: [{ x: 11.6, y: 2.4 }, { x: 12.6, y: 2.6 }, { x: 2.2, y: 3.4 }, { x: 3.3, y: 3.3 }, { x: 7.5, y: 0.9 }, { x: 3.6, y: 6.3 }, { x: 1.2, y: 6.0 }],
        gather: { x0: 0.6, y0: 0.5, x1: 3.6, y1: 3.7 },
        investorSpots: [{ x: 1.3, y: 0.8 }, { x: 2.3, y: 0.7 }, { x: 3.3, y: 1.2 }],
        overflow: [{ x: 3.2, y: 4.5 }, { x: 3.4, y: 5.4 }, { x: 0.8, y: 4.4 }, { x: 13.3, y: 2.6 }, { x: 12.4, y: 9.5 }, { x: 4.6, y: 9.5 }],
        ceo: { x: 2.1, y: 8.6 },
        safe: { x: 0.25, y: 8.9 },
        upgradeSlots: [{ x: 5.0, y: 0.25 }, { x: 6.3, y: 0.25 }, { x: 7.6, y: 0.25 }, { x: 9.0, y: 0.25 }, { x: 13.2, y: 5.6 }, { x: 13.2, y: 7.3 }],
      };
    }
  }
}

export class OfficeScene extends Phaser.Scene {
  private people = new Map<number, Person>();
  private visitors: Person[] = [];
  private bubbles: Bubble[] = [];
  private dogs: Dog[] = [];
  private cb!: OfficeCallbacks;
  private tooltip!: Phaser.GameObjects.Container;
  private tipMain!: Phaser.GameObjects.Text;
  private tipSub!: Phaser.GameObjects.Text;
  private tipBg!: Phaser.GameObjects.Graphics;
  private ceo!: Phaser.GameObjects.Container;
  private res = 1;
  private L!: Layout;
  private view: OfficeView = { tier: "openspace", floors: 0, upgrades: [], headcount: 0 };
  private viewKey = "";
  private remote = false;
  private worldW = 0;
  private worldH = 0;
  private ox = 0;
  private oy = 0;
  private spawnSeated = false;
  private safe?: Phaser.GameObjects.Container;
  private safeAmount = -1;
  private ledText?: Phaser.GameObjects.Text;
  private tiles: Pt[] = []; // remote: tile centres
  private tileW = 150;
  private tileH = 112;

  constructor() {
    super("office");
  }

  init(data: { cb: OfficeCallbacks }) {
    this.cb = data.cb;
  }

  create() {
    this.scale.on("resize", () => this.fitCamera());
    this.build();
    this.cb.onReady(this);
  }

  // ---------- world (re)building ----------

  /** Switch office tier / floors / upgrades. Rebuilds the scene when anything visible changes. */
  setView(v: OfficeView) {
    const key = `${v.tier}|${v.floors}|${v.upgrades.join(",")}|${v.tier === "remote" ? v.headcount : ""}`;
    this.view = v;
    if (key === this.viewKey) return;
    this.viewKey = key;
    this.build();
  }

  private build() {
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.children.list.slice().forEach((o) => o.destroy());
    this.people.clear();
    this.visitors = [];
    this.bubbles = [];
    this.dogs = [];
    this.safe = undefined;
    this.ledText = undefined;
    this.safeAmount = -1;
    this.spawnSeated = true;

    this.remote = this.view.tier === "remote";
    this.L = layoutFor(this.view.tier, this.view.floors);
    if (this.remote) {
      this.computeTiles(this.view.headcount + 5);
    } else {
      const { GW, GH } = this.L;
      this.ox = GH * (TW / 2) + 40;
      this.oy = WALL + 50;
      this.worldW = (GW + GH) * (TW / 2) + 80;
      this.worldH = (GW + GH) * (TH / 2) + WALL + 90;
    }
    this.fitCamera();

    this.tipBg = this.add.graphics();
    this.tipMain = this.txt(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "10.5px", fontStyle: "bold", color: "#ffffff", align: "center" }).setOrigin(0.5, 1);
    this.tipSub = this.txt(0, 0, "", { fontFamily: "system-ui, sans-serif", fontSize: "8.5px", color: "#c3cadb", align: "center", wordWrap: { width: 150 } }).setOrigin(0.5, 1);
    this.tooltip = this.add.container(0, 0, [this.tipBg, this.tipMain, this.tipSub]).setDepth(60_000).setVisible(false);

    if (this.remote) this.drawZoom();
    else {
      this.drawOffice();
      this.time.addEvent({ delay: 900, loop: true, callback: () => this.coffeeSteam() });
    }
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.randomEmote() });
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const zoom = Math.min(this.scale.width / this.worldW, this.scale.height / this.worldH);
    cam.setZoom(zoom);
    cam.centerOn(this.worldW / 2, this.worldH / 2 - (this.remote ? 0 : 10));
    this.res = Math.max(1, Math.ceil(zoom * 2) / 2);
  }

  /** Bubbles and labels stay the same on-screen size however far the camera zooms in (the garage is tiny). */
  private uiScale() {
    const cssZoom = this.cameras.main.zoom / (window.devicePixelRatio || 1);
    return Math.max(0.55, Math.min(1, 1.25 / cssZoom));
  }

  iso(gx: number, gy: number): Pt {
    return { x: this.ox + (gx - gy) * (TW / 2), y: this.oy + (gx + gy) * (TH / 2) };
  }

  /** Crisp text: rasterised at the camera's zoom. */
  private txt(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle) {
    return this.add.text(x, y, s, { resolution: this.res, ...style });
  }

  private has(upgrade: string) {
    return this.view.upgrades.includes(upgrade);
  }

  update(time: number) {
    for (const p of this.people.values()) this.animatePerson(p, time);
    for (const p of this.visitors) this.animatePerson(p, time);
    for (const d of this.dogs) if (d.walking) d.body.y = Math.abs(Math.sin(time / 60)) * -2;
    this.layoutBubbles();
  }

  // ---------- drawing helpers ----------

  private poly(g: Phaser.GameObjects.Graphics, pts: Pt[], fill: number, outline = true, alpha = 1) {
    g.fillStyle(fill, alpha).fillPoints(pts, true);
    if (outline) g.lineStyle(1.5, INK, 0.9).strokePoints(pts, true, true);
  }

  private tile(g: Phaser.GameObjects.Graphics, gx: number, gy: number, color: number, grout = 0xffffff) {
    const pts = [this.iso(gx, gy), this.iso(gx + 1, gy), this.iso(gx + 1, gy + 1), this.iso(gx, gy + 1)];
    g.fillStyle(color, 1).fillPoints(pts, true);
    g.lineStyle(1, grout, 0.35).strokePoints(pts, true, true);
  }

  private shade(c: number, f: number) {
    const col = Phaser.Display.Color.IntegerToColor(c);
    return Phaser.Display.Color.GetColor(Math.min(255, col.red * f), Math.min(255, col.green * f), Math.min(255, col.blue * f));
  }

  /** Iso box with cartoon outlines. Depth = its centre, so people sort correctly around it. */
  private box(gx: number, gy: number, w: number, d: number, h: number, top: number, z = 0) {
    const g = this.add.graphics();
    const p = (x: number, y: number, zz: number) => {
      const s = this.iso(x, y);
      return { x: s.x, y: s.y - zz };
    };
    const zt = z + h;
    this.poly(g, [p(gx, gy + d, zt), p(gx + w, gy + d, zt), p(gx + w, gy + d, z), p(gx, gy + d, z)], this.shade(top, 0.72));
    this.poly(g, [p(gx + w, gy + d, zt), p(gx + w, gy, zt), p(gx + w, gy, z), p(gx + w, gy + d, z)], this.shade(top, 0.86));
    this.poly(g, [p(gx, gy, zt), p(gx + w, gy, zt), p(gx + w, gy + d, zt), p(gx, gy + d, zt)], top);
    g.setDepth(this.iso(gx + w / 2, gy + d / 2).y);
    return g;
  }

  private wallPoly(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, z0: number, z1: number, fill: number, outline = true) {
    this.poly(g, [{ x: a.x, y: a.y - z0 }, { x: b.x, y: b.y - z0 }, { x: b.x, y: b.y - z1 }, { x: a.x, y: a.y - z1 }], fill, outline);
  }

  /** Text skewed onto the left (x=0) or back (y=0) wall. */
  private wallText(wall: "left" | "back", at: number, z: number, s: string, color: string, size = 11) {
    const p = wall === "left" ? this.iso(0, at) : this.iso(at, 0);
    const t = this.txt(p.x, p.y - z, s, { fontFamily: "Impact, 'Arial Black', sans-serif", fontSize: `${size}px`, color }).setOrigin(0.5).setDepth(3);
    t.setRotation(wall === "left" ? -Math.atan2(TH / 2, TW / 2) : Math.atan2(TH / 2, TW / 2));
    return t;
  }

  private label(gx: number, gy: number, text: string) {
    const p = this.iso(gx, gy);
    this.txt(p.x, p.y, text, { fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#2b2d4266", fontStyle: "bold" }).setOrigin(0.5).setDepth(1);
  }

  private emojiAt(gx: number, gy: number, z: number, e: string, size = 12, depthBoost = 1) {
    const p = this.iso(gx, gy);
    return this.txt(p.x, p.y - z, e, { fontSize: `${size}px` }).setOrigin(0.5).setDepth(p.y + depthBoost);
  }

  private plant(gx: number, gy: number, kind: "bush" | "tall" | "cactus") {
    this.box(gx, gy, 0.36, 0.36, 12, 0xd17a4a);
    const p = this.iso(gx + 0.18, gy + 0.18);
    const g = this.add.graphics().setDepth(p.y + 1);
    g.lineStyle(1.5, INK, 0.9);
    if (kind === "cactus") {
      g.fillStyle(0x57cc99).fillRoundedRect(p.x - 5, p.y - 40, 10, 28, 5).strokeRoundedRect(p.x - 5, p.y - 40, 10, 28, 5);
      g.fillRoundedRect(p.x + 4, p.y - 32, 8, 5, 2).fillRoundedRect(p.x + 8, p.y - 40, 5, 12, 2.5);
      g.fillStyle(0xff70a6).fillCircle(p.x, p.y - 42, 3);
    } else {
      const leaves = kind === "tall" ? [[0, -46, 9], [-7, -36, 8], [7, -34, 8], [0, -28, 9]] : [[-6, -24, 9], [6, -24, 9], [0, -31, 10]];
      for (const [dx, dy, r] of leaves) g.fillStyle(0x52b788).fillCircle(p.x + dx, p.y + dy, r).strokeCircle(p.x + dx, p.y + dy, r);
    }
  }

  private beanbag(gx: number, gy: number, c: number) {
    const p = this.iso(gx, gy);
    this.add.ellipse(p.x, p.y - 6, 30, 20, c).setStrokeStyle(1.5, INK, 0.9).setDepth(p.y);
  }

  private chair(gx: number, gy: number, color: number) {
    const ergo = this.has("chairs");
    const p = this.iso(gx, gy);
    const g = this.add.graphics().setDepth(p.y + 0.4);
    const c = ergo ? 0x2b2d42 : color;
    g.lineStyle(2, INK, 0.9);
    for (const a of [0, 1.26, 2.51, 3.77, 5.03]) g.lineBetween(p.x, p.y - 2, p.x + Math.cos(a) * 9, p.y - 2 + Math.sin(a) * 4);
    g.lineBetween(p.x, p.y - 2, p.x, p.y - 9);
    const backH = ergo ? 28 : 20;
    g.fillStyle(this.shade(c, 0.8)).fillRoundedRect(p.x - 9, p.y - 14 - backH, 18, backH, 6).lineStyle(1.5, INK).strokeRoundedRect(p.x - 9, p.y - 14 - backH, 18, backH, 6);
    if (ergo) g.fillStyle(0x06d6a0).fillRoundedRect(p.x - 6, p.y - 40, 12, 4, 2); // lumbar support, very expensive
    g.fillStyle(c).fillEllipse(p.x, p.y - 11, 22, 9).strokeEllipse(p.x, p.y - 11, 22, 9);
  }

  private desk(x: number, y: number, i: number, style: "folding" | "normal" | "glass") {
    const screens = [0x3a86ff, 0x06d6a0, 0x8338ec, 0xff006e, 0x2b2d42];
    this.chair(x + 0.55, y + 0.95, [0xef476f, 0x118ab2, 0x06d6a0, 0x8338ec][i % 4]);
    const top = style === "folding" ? 0xd9c7a7 : style === "glass" ? 0xe0fbfc : 0xffffff;
    this.box(x, y, 1.1, 0.6, style === "folding" ? 14 : 16, top);
    const z = style === "folding" ? 14 : 16;
    const mon = style === "folding" ? this.box(x + 0.4, y + 0.15, 0.35, 0.05, 9, 0x6c757d, z) : this.box(x + 0.35, y + 0.05, 0.42, 0.08, 16, screens[i % screens.length], z);
    mon.setDepth(this.iso(x + 0.55, y + 0.3).y + 0.5);
    const clutter = ["☕", "🦆", "🧃", "📎", "🪴", "🍕"][i % 6];
    const tp = this.iso(x + 0.95, y + 0.4);
    this.txt(tp.x, tp.y - z - 4, clutter, { fontSize: "10px" }).setOrigin(0.5).setDepth(this.iso(x + 0.55, y + 0.3).y + 0.6);
  }

  private floor(color: (x: number, y: number) => number, grout = 0xffffff) {
    const { GW, GH } = this.L;
    const g = this.add.graphics().setDepth(0);
    for (let x = 0; x < GW; x++) for (let y = 0; y < GH; y++) this.tile(g, x, y, color(x, y), grout);
    g.lineStyle(2, INK, 0.9).strokePoints([this.iso(0, 0), this.iso(GW, 0), this.iso(GW, GH), this.iso(0, GH)], true, true);
  }

  private walls(left: number, back: number, trim: number) {
    const { GW, GH } = this.L;
    const w = this.add.graphics().setDepth(0);
    this.wallPoly(w, this.iso(0, 0), this.iso(0, GH), 0, WALL, left);
    this.wallPoly(w, this.iso(0, 0), this.iso(GW, 0), 0, WALL, back);
    this.wallPoly(w, this.iso(0, 0), this.iso(0, GH), WALL - 6, WALL, trim);
    this.wallPoly(w, this.iso(0, 0), this.iso(GW, 0), WALL - 6, WALL, this.shade(trim, 1.08));
    return w;
  }

  private windows(w: Phaser.GameObjects.Graphics, xs: number[], width = 2.2) {
    for (const i of xs) {
      this.wallPoly(w, this.iso(i, 0), this.iso(i + width, 0), 22, 62, 0xa2d2ff);
      for (let k = 0; k < Math.floor(width * 2.2); k++) {
        const a = this.iso(i + 0.2 + k * 0.42, 0);
        const bh = 10 + ((k * 37 + i * 11) % 22);
        w.fillStyle(0x7b8cde, 0.55).fillRect(a.x - 4, a.y - 22 - bh, 7, bh);
      }
    }
  }

  private glassPane(x1: number, y1: number, x2: number, y2: number) {
    const glass = this.add.graphics().setDepth(2);
    const a = this.iso(x1, y1), b = this.iso(x2, y2);
    glass.fillStyle(0xdff6ff, 0.18).fillPoints([a, b, { x: b.x, y: b.y - 34 }, { x: a.x, y: a.y - 34 }], true);
    glass.lineStyle(1.5, INK, 0.5).lineBetween(a.x, a.y - 34, b.x, b.y - 34);
  }

  // ---------- offices ----------

  private drawOffice() {
    switch (this.view.tier) {
      case "garage":
        this.drawGarage();
        break;
      case "cowork":
        this.drawCowork();
        break;
      case "campus":
        this.drawCampus();
        break;
      default:
        this.drawOpenspace();
    }
    this.L.desks.forEach((d, i) => this.desk(d.x, d.y, i, this.view.tier === "garage" ? "folding" : this.view.tier === "campus" ? "glass" : "normal"));
    this.drawUpgrades();
    this.spawnCeo();
    this.spawnDog(0xc68642, "Biscuit · Chief Happiness Officer (has more equity than you)");
    if (this.has("dog2")) this.spawnDog(0x2b2d42, "Pixel · Deputy Happiness Officer (reports to Biscuit)");
    this.setOffshore(0);
  }

  private drawGarage() {
    this.floor((x, y) => ((x + y) % 2 ? 0xb5b5b5 : 0xbdbdbd), 0x999999);
    const w = this.walls(0xd6ccc2, 0xe3d5ca, 0x8d7b68);
    // roll-up garage door on the back wall
    this.wallPoly(w, this.iso(2.6, 0), this.iso(6.2, 0), 0, 64, 0xadb5bd);
    for (let z = 6; z < 64; z += 7) {
      const a = this.iso(2.6, 0), b = this.iso(6.2, 0);
      w.lineStyle(1, INK, 0.4).lineBetween(a.x, a.y - z, b.x, b.y - z);
    }
    // pegboard with tools
    this.wallPoly(w, this.iso(0, 1.2), this.iso(0, 3.6), 20, 60, 0xc9a66b);
    this.wallText("left", 2.4, 40, "🔧 🔨 🪛 🪚", "#000", 11);
    this.wallText("left", 5.3, 44, "DREAM BIG", "#ef476f", 14).setShadow(1, 1, "#000", 0, false, true);
    this.wallText("back", 7.6, 52, "est. last tuesday", "#2b2d42", 7);
    // single bare light bulb
    const bulb = this.iso(4.5, 3.5);
    this.add.graphics().setDepth(40_000).lineStyle(1, INK, 0.8).lineBetween(bulb.x, 20, bulb.x, bulb.y - 150);
    this.add.circle(bulb.x, bulb.y - 146, 6, 0xfff3b0).setStrokeStyle(1.5, INK).setDepth(40_000);
    // mattress, car under a tarp, workbench with the coffee maker, paint buckets
    this.box(0.3, 0.3, 1.6, 1.0, 6, 0xf1faee);
    this.emojiAt(0.6, 0.6, 12, "😴", 11);
    this.box(6.3, 2.4, 2.3, 1.4, 26, 0x5c7aa6);
    this.emojiAt(7.4, 3.1, 40, "🚗", 12, 2);
    this.box(6.2, 0.1, 2.6, 0.7, 22, 0x8d6e63);
    this.box(7.0, 0.2, 0.4, 0.35, 16, 0x343a40, 22);
    this.box(0.3, 4.3, 0.4, 0.4, 12, 0x4cc9f0);
    this.box(0.3, 4.8, 0.4, 0.4, 12, 0xffd166);
    // extension cord running everywhere
    const cord = this.add.graphics().setDepth(1);
    cord.lineStyle(2, 0xff8c42, 0.9).strokePoints([this.iso(0, 6.5), this.iso(1.5, 5.6), this.iso(2.6, 5.9), this.iso(3.4, 4.9), this.iso(4.6, 5.4), this.iso(5.2, 3.0)], false, false);
    // CEO "office": a camping chair next to a cardboard box
    this.box(6.9, 4.7, 0.6, 0.5, 12, 0xc8a27c);
    this.emojiAt(7.2, 4.95, 18, "📦", 11, 2);
    this.label(4.5, 6.75, "THE GARAGE");
  }

  private drawCowork() {
    const { GW, GH } = this.L;
    this.floor((x, y) => {
      if (x < 2.6 && y < 2.6) return (x + y) % 2 ? 0x9fd8b5 : 0xb0e0c2;
      if (x >= 10 && y < 2.6) return (x + y) % 2 ? 0xffe8b8 : 0xfff1d0;
      return (x + y) % 2 ? 0xc69c72 : 0xd2a984; // wooden floor
    }, 0x8d6e63);
    const w = this.walls(0x84a59d, 0x9ec1a3, 0x52796f);
    this.windows(w, [3.4, 6.6], 2.2);
    this.wallText("back", 2.2, 46, "good vibes only", "#ff4fd8", 10).setShadow(0, 0, "#ff4fd8", 8, false, true);
    this.wallPoly(w, this.iso(0, 3.5), this.iso(0, 5.5), 24, 60, 0xffffff);
    this.wallText("left", 4.5, 47, "WEEKLY", "#2b2d42", 8);
    this.wallText("left", 4.5, 37, "KOMBUCHA", "#06d6a0", 9);
    this.wallText("left", 4.5, 28, "SOCIAL 🍹", "#2b2d42", 8);
    // meeting booth, phone booth, kombucha bar
    this.glassPane(2.6, 0, 2.6, 2.6);
    this.glassPane(0, 2.6, 2.6, 2.6);
    this.box(0.6, 1.0, 1.5, 0.8, 13, 0xf4f1de);
    this.box(0.3, 4.2, 0.9, 0.9, 52, 0x3a86ff);
    this.emojiAt(0.75, 5.1, 30, "📞", 11, 2);
    this.box(10.1, 0.1, 1.8, 0.7, 24, 0x6f4518);
    this.box(10.9, 0.2, 0.35, 0.35, 18, 0xffd166, 24);
    this.emojiAt(10.4, 0.45, 36, "🫖", 11, 2);
    this.beanbag(1.8, 3.6, 0xef476f);
    this.beanbag(2.3, 4.6, 0xffd166);
    this.plant(11.4, 3.8, "tall");
    this.plant(2.4, 0.2, "cactus");
    // strangers from other startups on the remaining hot desks
    [{ x: 5.5, y: 6 }, { x: 7.5, y: 6 }].forEach((d, i) => {
      this.desk(d.x, d.y, i + 3, "normal");
      const f = this.makeFigure({ shirt: [0xf8f9fa, 0x000000][i], pants: 0x343a40, skin: SKIN[i + 1], hair: HAIR[i * 3], style: (["mohawk", "bun"] as const)[i], acc: (["headphones", "glasses"] as const)[i] });
      this.drawMouth(f.face, 70);
      const p = this.iso(d.x + 0.55, d.y + 0.95);
      f.c.setPosition(p.x, p.y).setDepth(p.y + 0.8);
      f.body.y = 4;
      f.body.scaleX = -1;
      f.c.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
      const tip = ["Not your employee. Works on a Web3 dating app. Says 'gm' to everyone.", "Not your employee. 'Building in stealth' for 4 years."][i];
      f.c.on("pointerover", () => this.showTip(f.c, tip));
      f.c.on("pointerout", () => this.hideTip());
      this.time.addEvent({ delay: 9000 + i * 4000, loop: true, callback: () => f.c.active && this.emote(f.c, ["🦄", "🧘", "📈", "gm"][Math.floor(Math.random() * 4)]) });
    });
    // standing desk for the CEO (no private office here)
    this.box(0.8, 6.0, 1.4, 0.6, 26, 0xffffff);
    this.label(1.3, 0.25, "BOOTH");
    this.label(GW - 1, 2.85, "KOMBUCHA BAR");
    this.label(6.5, GH - 0.3, "EVENT SPACE");
  }

  private drawOpenspace() {
    const wing = this.view.floors > 0;
    this.floor((x, y) => {
      const odd = (x + y) % 2 === 1;
      if (x < 4 && y < 4) return odd ? 0x9fd8b5 : 0xb0e0c2;
      if (x < 4 && y >= 6) return odd ? 0xc08b5c : 0xcc9a6c;
      if (x >= 11 && x < 14 && y < 4) return odd ? 0xffe8b8 : 0xfff1d0;
      if (x < 4 && y >= 4 && y < 6) return odd ? 0xf6bd60 : 0xf7c873;
      if (x >= 14) return odd ? 0xbcd4e6 : 0xc8deee; // east wing
      return odd ? 0xc5cee0 : 0xd0d8e8;
    });
    const w = this.walls(0xb8c0ff, 0xc8d0ff, 0x8e94f2);
    this.windows(w, wing ? [5, 8.2, 15, 17.4] : [5, 8.2]);
    this.wallPoly(w, this.iso(0, 6.4), this.iso(0, 8.4), 22, 60, 0xffd166);
    this.wallText("left", 7.4, 41, "HUSTLE", "#2b2d42", 13);
    this.wallPoly(w, this.iso(0, 4.3), this.iso(0, 5.8), 26, 58, 0xffffff);
    this.wallText("left", 5.05, 48, "LIVE LAUGH", "#ef476f", 8);
    this.wallText("left", 5.05, 37, "LEVERAGE", "#ef476f", 9);
    this.wallPoly(w, this.iso(0, 1.0), this.iso(0, 3.2), 18, 60, 0xffffff);
    const wb = [0.15, 0.35, 0.5, 0.7, 0.9].map((f, i) => {
      const q = this.iso(0, 1.3 + f * 1.6);
      return { x: q.x, y: q.y - [24, 30, 27, 38, 52][i] };
    });
    w.lineStyle(2, 0x06d6a0).strokePoints(wb, false, false);
    this.wallText("left", 2.1, 54, "Q4: 📈 TO THE MOON", "#118ab2", 7);
    this.wallText("back", 2.6, 46, "move fast & break payroll", "#ff4fd8", 10).setShadow(0, 0, "#ff4fd8", 8, false, true);
    this.wallPoly(w, this.iso(11.2, 0), this.iso(12.4, 0), 30, 54, 0xffffff);
    this.wallText("back", 11.8, 47, "EMPLOYEE OF", "#2b2d42", 6);
    this.wallText("back", 11.8, 40, "THE MONTH:", "#2b2d42", 6);
    this.wallText("back", 11.8, 33, "the CEO", "#e63946", 7);
    if (wing) this.wallText("back", 16.5, 70, "EAST WING", "#2b2d42", 12);

    this.label(2, 0.35, "MEETING ROOM");
    this.label(12.5, 3.75, "KITCHEN");
    this.label(2, 9.65, "CEO OFFICE");
    this.label(7, 9.8, "OPEN SPACE");
    this.label(2, 5.85, "CHILL ZONE");
    if (wing) this.label(16.5, 9.8, "EAST WING (+1 floor)");

    this.glassPane(4, 0, 4, 2.6); this.glassPane(0, 4, 2.8, 4);
    this.glassPane(4, 6, 4, 6.8); this.glassPane(4, 8.2, 4, 10); this.glassPane(0, 6, 2.8, 6);
    if (wing) { this.glassPane(14, 0, 14, 1.0); this.glassPane(14, 9.0, 14, 10); }

    this.box(1, 1.3, 2, 1.3, 14, 0xf4f1de);
    this.box(11, 0.1, 2.1, 0.75, 24, 0xe9edc9);
    this.box(12.2, 0.2, 0.5, 0.45, 22, this.has("espresso") ? 0xffd166 : 0x3d405b, 24);
    this.box(13.2, 0.15, 0.7, 0.75, 64, 0xf8f9fa);
    const cooler = this.iso(10.6, 0.5);
    this.box(10.4, 0.3, 0.4, 0.4, 26, 0xdee2e6);
    this.add.ellipse(cooler.x, cooler.y - 34, 14, 18, 0x9bf6ff, 0.85).setStrokeStyle(1.5, INK, 0.8).setDepth(cooler.y + 1);
    this.box(1, 4.4, 1.8, 1, 12, 0x2a9d8f);
    const n1 = this.iso(1.9, 4.4), n2 = this.iso(1.9, 5.4);
    this.add.graphics().setDepth(this.iso(1.9, 4.9).y + 1).lineStyle(2, 0xffffff).lineBetween(n1.x, n1.y - 16, n2.x, n2.y - 16);
    this.beanbag(3.2, 4.4, 0xef476f);
    this.beanbag(3.4, 5.3, 0x3a86ff);
    this.plant(4.25, 0.2, "tall");
    this.plant(10.4, 9.4, "bush");
    this.plant(0.25, 3.5, "cactus");
    if (!wing) this.plant(13.4, 4.3, "tall");
    this.plant(3.4, 9.4, "cactus");
    if (wing) { this.plant(19.5, 0.3, "tall"); this.plant(14.3, 9.4, "bush"); }
    this.box(0.9, 7.1, 2, 0.85, 18, 0x9c6644);
    const plate = this.iso(1.9, 7.95);
    this.txt(plate.x, plate.y - 9, "CHIEF", { fontFamily: "Impact, sans-serif", fontSize: "7px", color: "#ffd166" }).setOrigin(0.5).setDepth(plate.y + 1);
    this.emojiAt(1.2, 7.4, 26, "🏆", 14);
  }

  private drawCampus() {
    const { GH } = this.L;
    this.floor((x, y) => {
      const odd = (x + y) % 2 === 1;
      if (x < 5 && y < 5) return odd ? 0x9fd8b5 : 0xb0e0c2; // meeting rooms
      if (x < 5 && y >= 5 && y < 10) return odd ? 0xf6bd60 : 0xf7c873; // auditorium
      if (x < 5 && y >= 10) return odd ? 0x2b2d42 : 0x343a5c; // CEO suite (dark marble)
      if (x >= 14 && y < 3) return odd ? 0xffe8b8 : 0xfff1d0; // cafeteria
      if (x >= 5 && x < 14 && y < 3) return odd ? 0xffc8dd : 0xffd6e5; // fun zone
      return odd ? 0xe9f5f9 : 0xf4fbfd; // bright campus floor
    });
    const w = this.walls(0xcaf0f8, 0xade8f4, 0x48cae4);
    this.windows(w, [5.5, 8.5, 11.5, 14.5, 17.5], 2.4);
    this.wallText("left", 7, 46, "WE'RE A FAMILY™", "#e63946", 14);
    this.wallText("back", 3, 46, "think different-ish", "#0077b6", 11);
    this.wallText("back", 19.5, 70, "CAFETERIA", "#2b2d42", 10);
    // meeting rooms
    this.glassPane(5, 0, 5, 5); this.glassPane(0, 5, 5, 5); this.glassPane(0, 2.5, 5, 2.5);
    this.box(1, 1.2, 3, 0.9, 14, 0xf4f1de);
    this.box(1, 3.4, 3, 0.8, 14, 0xf4f1de);
    // auditorium bleachers facing a stage
    for (let i = 0; i < 3; i++) this.box(0.4 + i * 0.4, 5.6, 0.6, 3.6, 10 + i * 10, 0xffb703);
    this.box(3.9, 6.2, 0.9, 2.4, 6, 0x023047);
    this.emojiAt(4.3, 7.4, 14, "🎤", 12, 2);
    // CEO glass corner suite with a view
    this.glassPane(5, 10, 5, 14); this.glassPane(0, 10, 5, 10);
    this.box(1.4, 11, 2.6, 0.9, 18, 0x1d3557);
    this.emojiAt(1.8, 11.3, 30, "🏆", 14);
    this.emojiAt(3.6, 11.3, 30, "🗿", 13);
    // fun zone: a slide from the "upper floor" and a ball pit
    const sp = this.iso(9, 1.2);
    const slide = this.add.graphics().setDepth(sp.y + 2);
    slide.lineStyle(9, 0xffd166).beginPath().arc(sp.x, sp.y - 50, 26, Math.PI * 0.9, Math.PI * 2.4).strokePath();
    slide.lineStyle(2, INK).beginPath().arc(sp.x, sp.y - 50, 30, Math.PI * 0.9, Math.PI * 2.4).strokePath();
    slide.lineStyle(9, 0xffd166).lineBetween(sp.x + 20, sp.y - 34, sp.x + 40, sp.y);
    this.box(11.4, 0.4, 2, 1.6, 8, 0x90e0ef);
    for (let i = 0; i < 18; i++) {
      const b = this.iso(11.6 + ((i * 37) % 16) / 10, 0.6 + ((i * 53) % 12) / 10);
      this.add.circle(b.x, b.y - 9, 3, [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2][i % 4]).setDepth(this.iso(12.4, 1.2).y + 1);
    }
    // cafeteria
    this.box(14.3, 0.2, 7.4, 0.7, 24, 0xe9edc9);
    this.box(19, 0.3, 0.5, 0.45, 22, this.has("espresso") ? 0xffd166 : 0x3d405b, 24);
    this.emojiAt(15.2, 0.5, 34, "🥗", 11, 2);
    this.emojiAt(16.6, 0.5, 34, "🍣", 11, 2);
    this.emojiAt(17.8, 0.5, 34, "🥑", 11, 2);
    for (const x of [15, 17]) this.box(x, 1.5, 1.2, 0.6, 12, 0xffffff);
    this.plant(5.3, 0.3, "tall"); this.plant(13.6, 13.4, "bush"); this.plant(0.3, 9.4, "cactus"); this.plant(21.4, 3.2, "tall");
    this.label(2.5, 0.3, "MEETING ROOMS");
    this.label(2.5, 9.7, "AUDITORIUM");
    this.label(2.5, 13.7, "CEO SUITE");
    this.label(9, 2.7, "FUN ZONE (mandatory)");
    this.label(13.5, GH - 0.3, "CAMPUS");
  }

  /** Visible props for purchased upgrades. Flag-style upgrades (chairs, headphones, espresso) change existing art. */
  private drawUpgrades() {
    const props = this.view.upgrades.filter((id) => !["chairs", "headphones", "dog2", "espresso", "stipend", "zoombg"].includes(id));
    if (this.has("espresso")) {
      const c = this.L.coffee;
      this.emojiAt(c.x, c.y - 0.6, 46, "✨", 10, 60);
    }
    props.forEach((id, i) => {
      const s = this.L.upgradeSlots[i % this.L.upgradeSlots.length];
      switch (id) {
        case "climbing": {
          this.box(s.x, s.y, 1.0, 0.25, 70, 0x8338ec);
          const p = this.iso(s.x + 0.5, s.y + 0.25);
          const g = this.add.graphics().setDepth(p.y + 1);
          for (let k = 0; k < 9; k++) g.fillStyle([0xffd166, 0x06d6a0, 0xef476f][k % 3]).fillCircle(p.x - 14 + (k % 3) * 12 + (k % 2) * 3, p.y - 14 - Math.floor(k / 3) * 18, 3);
          break;
        }
        case "quietroom": {
          this.box(s.x, s.y, 0.9, 0.9, 50, 0x3d405b);
          this.emojiAt(s.x + 0.45, s.y + 0.9, 30, "🔕", 11, 2);
          const p = this.iso(s.x + 0.45, s.y + 0.45);
          this.time.addEvent({ delay: 3000, loop: true, callback: () => this.floatEmoji(p.x, p.y - 60, "💤") });
          break;
        }
        case "beerfridge":
          this.box(s.x, s.y, 0.6, 0.6, 40, 0xe63946);
          this.emojiAt(s.x + 0.3, s.y + 0.6, 24, "🍺", 12, 2);
          break;
        case "ledwall": {
          this.box(s.x, s.y, 1.4, 0.2, 56, 0x111111);
          const p = this.iso(s.x + 0.7, s.y + 0.2);
          this.ledText = this.txt(p.x, p.y - 32, `${this.cb.getValuation()} ▲`, { fontFamily: "monospace", fontSize: "10px", color: "#39ff14", fontStyle: "bold" }).setOrigin(0.5).setDepth(p.y + 2);
          this.time.addEvent({ delay: 1500, loop: true, callback: () => this.ledText?.setText(`${this.cb.getValuation()} ${Math.random() < 0.7 ? "▲" : "▼"}`) });
          break;
        }
        case "plantwall": {
          this.box(s.x, s.y, 1.2, 0.2, 60, 0x2d6a4f);
          const p = this.iso(s.x + 0.6, s.y + 0.2);
          const g = this.add.graphics().setDepth(p.y + 1);
          for (let k = 0; k < 14; k++) g.fillStyle([0x52b788, 0x74c69d, 0x95d5b2][k % 3]).fillCircle(p.x - 18 + (k % 5) * 9, p.y - 10 - Math.floor(k / 5) * 16 - (k % 2) * 5, 6);
          break;
        }
        case "robot": {
          const p = this.iso(s.x + 0.3, s.y + 0.3);
          const r = this.add.container(p.x, p.y).setDepth(p.y + 1);
          const g = this.add.graphics();
          g.fillStyle(0xdee2e6).fillRoundedRect(-9, -30, 18, 22, 5).lineStyle(1.5, INK).strokeRoundedRect(-9, -30, 18, 22, 5);
          g.fillStyle(0xdee2e6).fillCircle(0, -38, 9).strokeCircle(0, -38, 9);
          g.lineStyle(1.5, INK).lineBetween(0, -47, 0, -53);
          g.fillStyle(0xef476f).fillCircle(0, -54, 2.5);
          const eye = this.add.rectangle(0, -38, 10, 3, 0x39ff14);
          r.add([this.add.ellipse(0, 0, 18, 6, 0x000000, 0.15), g, eye]);
          this.tweens.add({ targets: eye, scaleX: 0.2, duration: 600, yoyo: true, repeat: -1, repeatDelay: 1800 });
          r.setInteractive(new Phaser.Geom.Rectangle(-12, -56, 24, 58), Phaser.Geom.Rectangle.Contains);
          r.on("pointerover", () => this.showTip(r, "AI receptionist. Definitely not recording this."));
          r.on("pointerout", () => this.hideTip());
          r.on("pointerdown", () => this.bubbleOn(r, Phaser.Utils.Array.GetRandom(["Hello, human. Your badge has been logged.", "I have summarised your face.", "Welcome! Please hold for synergy."])));
          break;
        }
        default: {
          const c = this.view.custom?.find((x) => x.id === id);
          if (!c) break;
          const p = this.iso(s.x + 0.4, s.y + 0.4);
          const prop = this.add.container(p.x, p.y).setDepth(p.y + 1);
          const g = this.add.graphics();
          g.fillStyle(0xf1f3f9).fillRoundedRect(-11, -14, 22, 14, 3).lineStyle(1.5, INK).strokeRoundedRect(-11, -14, 22, 14, 3);
          prop.add([this.add.ellipse(0, 0, 22, 7, 0x000000, 0.15), g, this.txt(0, -15, c.emoji, { fontSize: "20px" }).setOrigin(0.5, 1)]);
          prop.setInteractive(new Phaser.Geom.Rectangle(-14, -40, 28, 42), Phaser.Geom.Rectangle.Contains);
          prop.on("pointerover", () => this.showTip(prop, `${c.name} · ${c.blurb}`));
          prop.on("pointerout", () => this.hideTip());
          break;
        }
      }
    });
  }

  // ---------- remote: a Zoom call ----------

  private computeTiles(n: number) {
    const cols = Math.max(3, Math.ceil(Math.sqrt(n * 1.5)));
    const rows = Math.ceil(n / cols);
    const gap = 10;
    this.tiles = Array.from({ length: n }, (_, i) => ({
      x: 20 + (i % cols) * (this.tileW + gap) + this.tileW / 2,
      y: 70 + Math.floor(i / cols) * (this.tileH + gap) + this.tileH / 2,
    }));
    this.worldW = 40 + cols * (this.tileW + gap) - gap;
    this.worldH = 70 + rows * (this.tileH + gap) + 70;
  }

  private drawZoom() {
    this.add.rectangle(this.worldW / 2, this.worldH / 2, this.worldW + 2000, this.worldH + 2000, 0x1c1c24).setDepth(-10);
    this.txt(20, 22, "🔴 REC   Weekly All-Company Sync — 47 minutes over", { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffffff", fontStyle: "bold" }).setDepth(1);
    this.txt(20, 44, "Remote-first since the lease ended. Click a tile for a 1:1.", { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#adb5bd" }).setDepth(1);
    const bar = this.worldH - 40;
    this.add.rectangle(this.worldW / 2, bar, 360, 36, 0x2b2b36).setStrokeStyle(1, 0x444455).setDepth(1);
    this.txt(this.worldW / 2, bar, "🎤   📹   🖥️   😀   ✋   ⋯   Leave", { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffffff" }).setOrigin(0.5).setDepth(2);
    // tile 0: the CEO on a "workation"; tile 1: the dog
    this.zoomTile(0, "You (CEO) · Bali 🏝️", 0x48cae4, true);
    this.ceo = this.makeFigure({ shirt: 0xf8f9fa, pants: 0x1a1a2e, skin: 0xffd8b1, hair: 0x1a1a1a, style: "bowl", acc: "none", ceo: true }).c;
    this.placeInTile(this.ceo, 0);
    this.ceo.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
    this.ceo.on("pointerdown", () => this.cb.onCeoClick());
    this.ceo.on("pointerover", () => this.showTip(this.ceo, "You, the CEO. Click for your secret finances 🕶️"));
    this.ceo.on("pointerout", () => this.hideTip());
    this.zoomTile(1, "Biscuit (guest)", 0x99582a);
    const dt = this.tiles[1];
    this.txt(dt.x, dt.y - 4, "🐶", { fontSize: "48px" }).setOrigin(0.5).setDepth(5);
    this.setOffshore(0);
  }

  private zoomTile(i: number, name: string, bg: number, beach = false) {
    const t = this.tiles[i];
    if (!t) return;
    const g = this.add.graphics().setDepth(0);
    const x = t.x - this.tileW / 2, y = t.y - this.tileH / 2;
    const branded = this.has("zoombg") && i > 1;
    if (beach || branded) {
      g.fillStyle(0x90e0ef).fillRoundedRect(x, y, this.tileW, this.tileH, 8);
      g.fillStyle(0xffe8a3).fillRect(x, y + this.tileH * 0.65, this.tileW, this.tileH * 0.35);
      g.fillStyle(0xffd166).fillCircle(x + this.tileW - 24, y + 22, 12);
    } else {
      g.fillStyle(bg).fillRoundedRect(x, y, this.tileW, this.tileH, 8);
      // a bookshelf or a window, the classic "I'm working" backgrounds
      if (i % 2) {
        g.fillStyle(this.shade(bg, 0.7)).fillRect(x + 10, y + 10, 40, 50);
        for (let k = 0; k < 4; k++) g.fillStyle([0xef476f, 0x118ab2, 0xffd166, 0x06d6a0][(k + i) % 4]).fillRect(x + 13 + k * 9, y + 14, 6, 18);
      } else {
        g.fillStyle(0xcaf0f8).fillRect(x + this.tileW - 55, y + 12, 42, 32);
      }
    }
    if (this.has("stipend") && i > 1) g.lineStyle(3, 0xfff3b0, 0.9).strokeCircle(x + 24, y + 26, 12); // ring light
    g.lineStyle(2, 0x000000, 0.4).strokeRoundedRect(x, y, this.tileW, this.tileH, 8);
    // desk edge hides legs
    const desk = this.add.graphics().setDepth(10);
    desk.fillStyle(0x6f4518).fillRect(x, y + this.tileH - 18, this.tileW, 18);
    desk.fillStyle(0x000000, 0.55).fillRoundedRect(x + 6, y + this.tileH - 20, Math.min(this.tileW - 12, name.length * 5.6 + 10), 16, 4);
    this.txt(x + 11, y + this.tileH - 18, name, { fontFamily: "system-ui, sans-serif", fontSize: "10px", color: "#fff" }).setDepth(11);
    if (branded) this.txt(x + this.tileW - 8, y + 6, "#WeAreFamily", { fontFamily: "Impact, sans-serif", fontSize: "9px", color: "#e63946" }).setOrigin(1, 0).setDepth(11);
  }

  private placeInTile(c: Phaser.GameObjects.Container, i: number) {
    const t = this.tiles[i] ?? this.tiles[this.tiles.length - 1];
    c.setPosition(t.x, t.y + this.tileH / 2 + 4).setScale(1.5).setDepth(5);
  }

  // ---------- CEO, safe, money ----------

  private spawnCeo() {
    this.ceo = this.makeFigure({ shirt: 0x2b2d42, pants: 0x1a1a2e, skin: 0xffd8b1, hair: 0x1a1a1a, style: "bowl", acc: "none", ceo: true }).c;
    const cp = this.iso(this.L.ceo.x, this.L.ceo.y);
    this.ceo.setPosition(cp.x, cp.y).setDepth(cp.y);
    this.ceo.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
    this.ceo.on("pointerdown", () => this.cb.onCeoClick());
    this.ceo.on("pointerover", () => this.showTip(this.ceo, "You, the CEO. Click for your secret finances 🕶️"));
    this.ceo.on("pointerout", () => this.hideTip());
    this.tweens.add({ targets: this.ceo, angle: { from: -3, to: 3 }, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  }

  setOffshore(amount: number) {
    if (amount === this.safeAmount) return;
    const grew = this.safeAmount >= 0 && amount > this.safeAmount;
    this.safeAmount = amount;
    this.safe?.destroy();
    const bags = Math.min(6, Math.floor(amount / 250_000));
    if (this.remote) {
      // remote: money bags pile up on the CEO's tile
      const t = this.tiles[0];
      const items: Phaser.GameObjects.GameObject[] = [];
      for (let i = 0; i < bags; i++) items.push(this.txt(t.x - this.tileW / 2 + 14 + i * 12, t.y - this.tileH / 2 + 10, "💰", { fontSize: "11px" }));
      this.safe = this.add.container(0, 0, items).setDepth(12);
      return;
    }
    const gx = this.L.safe.x, gy = this.L.safe.y;
    const small = this.view.tier === "garage";
    const size = small ? 0.45 : 0.7;
    const h = (small ? 12 : 20) + Math.min(70, (amount / 1_000_000) * 18);
    const g = this.box(gx, gy, size, size, h, small ? 0xc8a27c : 0x6c757d);
    const top = this.iso(gx + size / 2, gy + size / 2);
    const front = this.iso(gx + size / 2, gy + size);
    const dial = this.add.graphics();
    if (!small) dial.fillStyle(0xffd166).fillCircle(front.x - 9, front.y - h / 2, 4).lineStyle(1.5, INK).strokeCircle(front.x - 9, front.y - h / 2, 4);
    const sign = this.txt(front.x - 9, front.y - h / 2 - 12, small ? "shoebox" : "Zug", { fontFamily: "Impact, sans-serif", fontSize: "7px", color: small ? "#2b2d42" : "#ffd166" }).setOrigin(0.5);
    const items: Phaser.GameObjects.GameObject[] = [g, dial, sign];
    for (let i = 0; i < bags; i++) items.push(this.txt(top.x - 10 + (i % 3) * 10, top.y - h - 6 - Math.floor(i / 3) * 9, "💰", { fontSize: "11px" }).setOrigin(0.5));
    this.safe = this.add.container(0, 0, items).setDepth(top.y + 1);
    const zone = this.add.zone(top.x, top.y - h / 2, 40, h + 20).setInteractive();
    this.safe.add(zone);
    zone.on("pointerover", () => {
      const what = small ? "Shoebox labelled 'TAXES (DO NOT OPEN)'" : "Totally normal office safe";
      this.showTip({ x: top.x, y: top.y - h + 30 }, amount ? `${what} · $${(amount / 1e6).toFixed(2)}M of "consulting"` : `${what} · empty`);
    });
    zone.on("pointerout", () => this.hideTip());
    if (grew) this.tweens.add({ targets: this.safe, scaleY: { from: 0.9, to: 1 }, duration: 300, ease: "Back.out" });
  }

  /** Banknotes fly from the team into the safe. */
  moneyFly() {
    const to = this.remote ? { x: this.tiles[0].x, y: this.tiles[0].y + 50 } : this.iso(this.L.safe.x + 0.3, this.L.safe.y + 0.3);
    const sources = [...this.people.values()];
    for (let i = 0; i < 14; i++) {
      const src = sources.length ? Phaser.Utils.Array.GetRandom(sources).c : { x: this.worldW / 2, y: this.worldH / 2 };
      const t = this.txt(src.x, src.y - 30, "💸", { fontSize: "14px" }).setOrigin(0.5).setDepth(57_000);
      this.tweens.add({
        targets: t,
        x: to.x,
        y: to.y - 50,
        angle: Phaser.Math.Between(-200, 200),
        delay: i * 90,
        duration: 1100,
        ease: "Cubic.in",
        onComplete: () => t.destroy(),
      });
    }
  }

  // ---------- characters ----------

  private makeFigure(o: { shirt: number; pants: number; skin: number; hair: number; style: HairStyle; acc: Accessory; ceo?: boolean }) {
    const c = this.add.container(0, 0);
    const body = this.add.container(0, 0);
    const shadow = this.add.ellipse(0, 0, 22, 8, 0x000000, 0.18);
    const acc: Accessory | "shades" = o.ceo ? "shades" : this.has("headphones") ? "headphones" : o.acc;

    const leg = (dx: number) => {
      const l = this.add.graphics();
      l.fillStyle(o.pants).fillRoundedRect(-3, -9, 6, 10, 3).lineStyle(1.5, INK).strokeRoundedRect(-3, -9, 6, 10, 3);
      l.fillStyle(0x2b2d42).fillEllipse(0, 1, 8, 4);
      l.x = dx;
      return l;
    };
    const legL = leg(-4);
    const legR = leg(4);

    const torso = this.add.graphics();
    torso.fillStyle(o.shirt).fillRoundedRect(-10, -26, 20, 19, 8).lineStyle(1.5, INK).strokeRoundedRect(-10, -26, 20, 19, 8);
    torso.fillStyle(this.shade(o.shirt, 0.85)).fillEllipse(-11, -17, 6, 12).strokeEllipse(-11, -17, 6, 12);
    torso.fillEllipse(11, -17, 6, 12).strokeEllipse(11, -17, 6, 12);
    torso.fillStyle(o.skin).fillCircle(-11, -11, 2.6).fillCircle(11, -11, 2.6);
    if (o.ceo) {
      torso.fillStyle(0xffffff).fillTriangle(-4, -26, 4, -26, 0, -19);
      torso.fillStyle(0xe63946).fillTriangle(-2, -22, 2, -22, 0, -10).lineStyle(1, INK).strokeTriangle(-2, -22, 2, -22, 0, -10);
      torso.lineStyle(1.5, 0xffd166).beginPath().arc(0, -24, 6, 0.3, Math.PI - 0.3).strokePath();
    }

    const head = this.add.graphics();
    const hy = -40;
    if (o.style === "long") head.fillStyle(o.hair).fillRoundedRect(-12, hy - 6, 24, 22, 8);
    if (o.style === "bun") head.fillStyle(o.hair).fillCircle(0, hy - 14, 6).lineStyle(1.5, INK).strokeCircle(0, hy - 14, 6);
    head.fillStyle(o.skin).fillCircle(0, hy, 12).lineStyle(1.5, INK).strokeCircle(0, hy, 12);
    head.fillStyle(this.shade(o.skin, 0.95)).fillCircle(-12, hy + 1, 3).fillCircle(12, hy + 1, 3);
    head.fillStyle(0xff8fab, 0.45).fillCircle(-6, hy + 5, 2.6).fillCircle(6, hy + 5, 2.6);
    head.fillStyle(o.hair).lineStyle(1.5, INK);
    switch (o.style) {
      case "bowl":
      case "long":
      case "bun":
        head.beginPath().arc(0, hy - 1, 12.5, Math.PI, 0).closePath().fillPath().strokePath();
        break;
      case "spiky":
        for (let i = -2; i <= 2; i++) head.fillTriangle(i * 5 - 4, hy - 7, i * 5 + 4, hy - 7, i * 5, hy - 18);
        head.beginPath().arc(0, hy - 2, 12, Math.PI, 0).closePath().fillPath();
        break;
      case "mohawk":
        head.fillRoundedRect(-3, hy - 21, 6, 14, 3).strokeRoundedRect(-3, hy - 21, 6, 14, 3);
        break;
      case "curly":
        for (const [dx, dy] of [[-9, -6], [-4, -10], [2, -11], [8, -7], [11, -2], [-11, -1]]) head.fillCircle(dx, hy + dy, 5);
        break;
      case "bald":
        head.fillStyle(0xffffff, 0.6).fillEllipse(-4, hy - 7, 5, 3);
        break;
    }
    const eyes = this.add.graphics();
    eyes.fillStyle(INK).fillEllipse(-4.5, hy + 0.5, 3, 4).fillEllipse(4.5, hy + 0.5, 3, 4);
    eyes.fillStyle(0xffffff).fillCircle(-4, hy - 0.5, 0.8).fillCircle(5, hy - 0.5, 0.8);
    const face = this.add.graphics();
    const extra = this.add.graphics();
    extra.lineStyle(1.5, INK);
    switch (acc) {
      case "shades":
        extra.fillStyle(0x111111).fillRoundedRect(-11, hy - 3, 9, 6, 2).fillRoundedRect(2, hy - 3, 9, 6, 2).lineBetween(-2, hy - 1, 2, hy - 1);
        extra.fillStyle(0xffffff, 0.5).fillRect(-9, hy - 2, 3, 1.5).fillRect(4, hy - 2, 3, 1.5);
        break;
      case "glasses":
        extra.strokeCircle(-4.5, hy + 0.5, 4).strokeCircle(4.5, hy + 0.5, 4).lineBetween(-0.5, hy + 0.5, 0.5, hy + 0.5);
        break;
      case "headphones":
        extra.lineStyle(3, 0x2b2d42).beginPath().arc(0, hy, 14, Math.PI, 0).strokePath();
        extra.fillStyle(0xef476f).fillRoundedRect(-16, hy - 3, 5, 9, 2).fillRoundedRect(11, hy - 3, 5, 9, 2);
        break;
      case "beard":
        extra.fillStyle(0x5a3825).beginPath().arc(0, hy + 4, 10, 0.2, Math.PI - 0.2).closePath().fillPath();
        break;
      case "cap":
        extra.fillStyle(0x3a86ff).beginPath().arc(0, hy - 3, 12.5, Math.PI, 0).closePath().fillPath().strokePath();
        extra.fillRoundedRect(2, hy - 6, 14, 4, 2).strokeRoundedRect(2, hy - 6, 14, 4, 2);
        break;
    }
    body.add([torso, head, eyes, face, extra]);
    c.add([shadow, legL, legR, body]);
    if (o.ceo) {
      body.add(this.txt(14, -22, "☕", { fontSize: "11px" }).setOrigin(0.5));
      this.drawMouth(face, 90);
    }
    return { c, body, legL, legR, face, eyes };
  }

  private drawMouth(face: Phaser.GameObjects.Graphics, mood: number) {
    const hy = -40;
    face.clear().lineStyle(1.6, INK);
    if (mood > 60) {
      face.fillStyle(0xffffff).beginPath().arc(0, hy + 5, 4, 0.1, Math.PI - 0.1).closePath().fillPath().strokePath();
    } else if (mood > 35) {
      face.lineBetween(-3, hy + 7, 3, hy + 7);
    } else {
      face.beginPath().arc(0, hy + 10, 4, Math.PI + 0.4, -0.4).strokePath();
      face.lineBetween(-7, hy - 5, -2, hy - 3).lineBetween(7, hy - 5, 2, hy - 3);
    }
  }

  /** Compact label right above someone's head: "Name · details" puts the details on a smaller second line. */
  private showTip(obj: { x: number; y: number }, text: string) {
    const [main, ...rest] = text.split(" · ");
    const sub = rest.join(" · ");
    this.tipSub.setText(sub).setVisible(!!sub).setY(0);
    this.tipMain.setText(main).setY(sub ? -this.tipSub.height : 0);
    const w = Math.max(this.tipMain.width, sub ? this.tipSub.width : 0) + 10;
    const h = this.tipMain.height + (sub ? this.tipSub.height : 0) + 5;
    this.tipBg.clear().fillStyle(0x2b2d42, 0.93).fillRoundedRect(-w / 2, -h + 2.5, w, h, 5);
    this.tooltip.setScale(this.uiScale()).setPosition(obj.x, obj.y - (this.remote ? 84 : 54)).setVisible(true);
    this.input.setDefaultCursor("pointer");
  }

  private hideTip() {
    this.tooltip.setVisible(false);
    this.input.setDefaultCursor("default");
  }

  // ---------- people ----------

  /** Where someone works: their desk's chair, or a beanbag/corner if they're hot-desking. */
  private home(e: Employee): Pt {
    if (this.hasDesk(e)) {
      const d = this.L.desks[e.desk];
      return { x: d.x + 0.55, y: d.y + 0.95 };
    }
    const n = this.L.overflow.length;
    const o = this.L.overflow[e.id % n];
    const k = Math.floor(e.id / n);
    return { x: o.x + (k % 2) * 0.35, y: o.y + (k % 3) * 0.25 };
  }

  private hasDesk(e: Employee) {
    return e.desk >= 0 && e.desk < this.L.desks.length;
  }

  private place(p: { c: Phaser.GameObjects.Container; g: Pt }) {
    const s = this.iso(p.g.x, p.g.y);
    p.c.setPosition(s.x, s.y).setDepth(s.y + 0.8);
  }

  sync(employees: Employee[]) {
    const ids = new Set(employees.map((e) => e.id));
    for (const id of [...this.people.keys()]) if (!ids.has(id)) this.leave(id);
    employees.forEach((e, idx) => {
      const p = this.people.get(e.id);
      if (p) {
        const deskChanged = p.data.desk !== e.desk;
        p.data = e;
        const m = this.cb.getMood(e.id);
        if (m !== p.lastMood) {
          this.drawMouth(p.face, m);
          p.lastMood = m;
          p.camOff?.setVisible(m < 30);
        }
        p.badge.setText(this.cb.getBadge(e.id));
        if (deskChanged && !this.remote) this.walkTo(p, this.home(e), () => this.settle(p));
      } else this.spawn(e, idx);
    });
    this.spawnSeated = false;
  }

  private spawn(e: Employee, idx: number) {
    const r = (n: number, salt: number) => (e.id * 7919 + salt * 104729) % n;
    const f = this.makeFigure({
      shirt: SHIRTS[r(SHIRTS.length, 1)],
      pants: PANTS[r(PANTS.length, 2)],
      skin: SKIN[r(SKIN.length, 3)],
      hair: HAIR[r(HAIR.length, 4)],
      style: HAIRSTYLES[r(HAIRSTYLES.length, 5)],
      acc: ACCESSORIES[r(ACCESSORIES.length, 6)],
    });
    const mood = this.cb.getMood(e.id);
    this.drawMouth(f.face, mood);
    const start = this.spawnSeated || this.remote ? this.home(e) : { ...this.L.door };
    const badge = this.txt(13, -54, this.cb.getBadge(e.id), { fontSize: "10px" }).setOrigin(0, 1);
    f.c.add(badge);
    const p: Person = { data: e, ...f, g: start, walking: false, seated: false, phase: Math.random() * 10, lastMood: mood, badge };
    this.people.set(e.id, p);
    f.c.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
    f.c.on("pointerdown", () => this.cb.onEmployeeClick(e.id));
    f.c.on("pointerover", () => this.showTip(f.c, `${p.data.name} · ${titleOf(p.data)}${!this.remote && !this.hasDesk(p.data) ? " · no desk 😤" : ""}`));
    f.c.on("pointerout", () => this.hideTip());
    this.time.addEvent({
      delay: 2500 + Math.random() * 3000,
      loop: true,
      callback: () => p.c.active && this.tweens.add({ targets: p.eyes, scaleY: 0.1, y: -40 * 0.9, duration: 70, yoyo: true }),
    });
    if (this.remote) {
      const slot = idx + 2;
      this.zoomTile(slot, e.name, [0xe9c46a, 0x84a59d, 0xcdb4db, 0xa8dadc, 0xf4a261][e.id % 5]);
      this.placeInTile(f.c, slot);
      f.body.scaleX = 1;
      const t = this.tiles[slot];
      if (t) {
        const off = this.add.container(0, 0).setDepth(9);
        const bg = this.add.rectangle(t.x, t.y - 9, this.tileW, this.tileH - 18, 0x2b2b36);
        const initials = e.name.split(" ").map((w) => w[0]).join("");
        const circle = this.add.circle(t.x, t.y - 10, 22, SHIRTS[r(SHIRTS.length, 1)]);
        const ini = this.txt(t.x, t.y - 10, initials, { fontFamily: "system-ui, sans-serif", fontSize: "16px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5);
        const note = this.txt(t.x, t.y + 22, "camera off", { fontFamily: "system-ui, sans-serif", fontSize: "9px", color: "#adb5bd" }).setOrigin(0.5);
        off.add([bg, circle, ini, note]);
        off.setVisible(mood < 30);
        p.camOff = off;
      }
      return;
    }
    this.place(p);
    if (this.spawnSeated) this.settle(p);
    else this.walkTo(p, this.home(e), () => this.settle(p));
  }

  private animatePerson(p: Person, time: number) {
    const t = time / 150 + p.phase; // leg cadence matches the (unhurried) walking speed
    if (p.walking) {
      p.legL.y = Math.sin(t) * 2.5;
      p.legR.y = -Math.sin(t) * 2.5;
      p.body.y = -Math.abs(Math.sin(t)) * 2.5;
    } else if (p.seated) {
      p.legL.y = p.legR.y = -3;
      const typing = p.lastMood > 30;
      p.body.y = 4 + (typing ? Math.sin(t * 2.2) * 0.6 : 1.5 + Math.sin(time / 600 + p.phase)); // sunk into the chair; slumped when demotivated
    } else {
      p.legL.y = p.legR.y = 0;
      p.body.y = Math.sin(time / 500 + p.phase) * 0.6;
    }
  }

  /** Waypoints that stay in aisles and corridors instead of cutting through desks. */
  private route(from: Pt, to: Pt): Pt[] {
    if (this.remote) return [to];
    const { aisles, corridors, deskArea: a } = this.L;
    const aisle = (x: number) => aisles.reduce((p, q) => (Math.abs(q - x) < Math.abs(p - x) ? q : p));
    const inDeskArea = (q: Pt) => q.x > a.x0 && q.x < a.x1 && q.y > a.y0 && q.y < a.y1;
    if (!inDeskArea(from) && !inDeskArea(to)) return [to];
    const cy = corridors.reduce((p, q) => (Math.abs(from.y - q) + Math.abs(to.y - q) < Math.abs(from.y - p) + Math.abs(to.y - p) ? q : p));
    const ax1 = inDeskArea(from) ? aisle(from.x) : from.x;
    const ax2 = inDeskArea(to) ? aisle(to.x) : to.x < a.x0 ? aisles[0] : to.x;
    const pts: Pt[] = [{ x: ax1, y: from.y }, { x: ax1, y: cy }, { x: ax2, y: cy }, { x: ax2, y: to.y }, to];
    return pts.filter((q, i, arr) => Math.hypot(q.x - (i ? arr[i - 1].x : from.x), q.y - (i ? arr[i - 1].y : from.y)) > 0.05);
  }

  private walkTo(p: Person, to: Pt, done?: () => void, msPerTile = 650) {
    p.timer?.remove();
    this.tweens.killTweensOf(p.g);
    p.seated = false;
    if (this.remote) {
      done?.();
      return;
    }
    p.walking = true;
    const path = this.route({ ...p.g }, to);
    const step = (i: number) => {
      if (!p.c.active) return;
      if (i >= path.length) {
        p.walking = false;
        done?.();
        return;
      }
      const q = path[i];
      const dist = Math.hypot(q.x - p.g.x, q.y - p.g.y);
      const dxScreen = q.x - p.g.x - (q.y - p.g.y);
      if (Math.abs(dxScreen) > 0.01) p.body.scaleX = dxScreen > 0 ? 1 : -1;
      this.tweens.add({
        targets: p.g,
        x: q.x,
        y: q.y,
        duration: Math.max(120, dist * msPerTile),
        onUpdate: () => this.place(p),
        onComplete: () => step(i + 1),
      });
    };
    step(0);
  }

  /** Arrived home: sit if there's a chair, otherwise sulk on the beanbag. */
  private settle(p: Person) {
    p.seated = this.hasDesk(p.data);
    p.body.scaleX = -1;
    if (!p.seated && Math.random() < 0.5) this.emote(p.c, Phaser.Utils.Array.GetRandom(["😤", "🪑?", "😩"]));
    this.idle(p);
  }

  private idle(p: Person) {
    if (this.remote) return;
    p.timer = this.time.delayedCall(Phaser.Math.Between(5000, 16000), () => {
      if (!this.people.has(p.data.id)) return;
      const c = this.L.coffee;
      const target =
        Math.random() < 0.5
          ? { x: c.x - 0.4 + Math.random() * 0.7, y: c.y + 0.4 + Math.random() * 0.5 }
          : (() => {
              const h = Phaser.Utils.Array.GetRandom(this.L.hangouts);
              return { x: h.x + Math.random() * 0.4, y: h.y + Math.random() * 0.4 };
            })();
      this.walkTo(p, target, () => {
        if (Math.random() < 0.4) this.emote(p.c, Math.hypot(target.x - c.x, target.y - c.y) < 1.2 ? "☕" : this.moodEmote(p.lastMood));
        p.timer = this.time.delayedCall(Phaser.Math.Between(2000, 5000), () => this.walkTo(p, this.home(p.data), () => this.settle(p)));
      });
    });
  }

  private moodEmote(m: number) {
    return Phaser.Utils.Array.GetRandom(m < 35 ? LOW_EMOTES : m > 65 ? HIGH_EMOTES : MID_EMOTES);
  }

  private randomEmote() {
    const all = [...this.people.values()];
    if (!all.length) return;
    const p = Phaser.Utils.Array.GetRandom(all);
    if (this.cb.inCrisis() && Math.random() < 0.35) {
      this.emote(p.c, Phaser.Utils.Array.GetRandom(["🔥", "🚨", "😱", "🧯"]));
      return;
    }
    if (this.remote) {
      if (p.camOff?.visible) return;
      this.emote(p.c, Phaser.Utils.Array.GetRandom(["🔇", "👋", "🍕", "🐈", "📶", this.moodEmote(p.lastMood)]));
      return;
    }
    if (!this.hasDesk(p.data) && !p.walking && Math.random() < 0.5) this.emote(p.c, "🪑?");
    else if (p.seated && p.lastMood < 30 && Math.random() < 0.6) this.emote(p.c, "💤");
    else if (Math.random() < 0.5) this.emote(p.c, this.moodEmote(p.lastMood));
  }

  emote(target: { x: number; y: number }, e: string) {
    this.floatEmoji(target.x, target.y - (this.remote ? 90 : 62), e);
  }

  private floatEmoji(x: number, y: number, e: string) {
    const t = this.txt(x, y, e, { fontSize: "16px", fontFamily: "system-ui, sans-serif", color: "#2b2d42", fontStyle: "bold" }).setOrigin(0.5).setDepth(50_000).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: "Back.out" });
    this.tweens.add({ targets: t, y: t.y - 22, alpha: 0, delay: 900, duration: 700, onComplete: () => t.destroy() });
  }

  private coffeeSteam() {
    const c = this.L.coffee;
    const p = this.iso(c.x, c.y - 0.9);
    const s = this.add.circle(p.x + Phaser.Math.Between(-2, 2), p.y - 48, 3, 0xffffff, 0.8).setDepth(p.y + 50);
    this.tweens.add({ targets: s, y: s.y - 20, alpha: 0, scale: 2.2, duration: 1600, onComplete: () => s.destroy() });
  }

  leave(id: number) {
    const p = this.people.get(id);
    if (!p) return;
    this.people.delete(id);
    p.timer?.remove();
    this.drawMouth(p.face, 10);
    this.bubbleOn(p.c, Phaser.Utils.Array.GetRandom(["Bye.", "Good luck with the IPO lol", "Taking my stapler.", "See you on LinkedIn.", "I'm keeping the hoodie."]), false, `${p.data.name.split(" ")[0]} · ${titleOf(p.data)}`);
    const targets: Phaser.GameObjects.GameObject[] = p.camOff ? [p.c, p.camOff] : [p.c];
    const vanish = () =>
      this.tweens.add({
        targets,
        alpha: 0,
        duration: 400,
        delay: this.remote ? 1500 : 0,
        onComplete: () => {
          this.bubbles = this.bubbles.filter((b) => b.target !== p.c);
          p.c.destroy();
          p.camOff?.destroy();
        },
      });
    if (this.remote) vanish();
    else this.walkTo(p, { ...this.L.door }, vanish);
  }

  // ---------- dogs ----------

  private spawnDog(color: number, tip: string) {
    const c = this.add.container(0, 0);
    const body = this.add.container(0, 0);
    const g = this.add.graphics();
    g.lineStyle(1.5, INK).fillStyle(color);
    g.fillEllipse(0, -8, 22, 12).strokeEllipse(0, -8, 22, 12);
    g.fillCircle(10, -15, 7).strokeCircle(10, -15, 7);
    g.fillStyle(this.shade(color, 0.7)).fillEllipse(6, -18, 5, 9).fillEllipse(14, -18, 5, 9);
    g.fillStyle(color === INK ? 0xffffff : INK).fillCircle(12, -16, 1.4).fillCircle(16, -13, 1.8);
    g.lineStyle(2, color).lineBetween(-10, -10, -15, -16);
    g.fillStyle(0xe63946).fillRect(5, -11, 8, 2);
    body.add(g);
    c.add([this.add.ellipse(0, 0, 22, 6, 0x000000, 0.15), body]);
    const start = Phaser.Utils.Array.GetRandom(this.L.hangouts);
    const dog: Dog = { c, body, g: { ...start }, walking: false };
    this.dogs.push(dog);
    this.place(dog);
    c.setInteractive(new Phaser.Geom.Rectangle(-12, -24, 30, 26), Phaser.Geom.Rectangle.Contains);
    c.on("pointerover", () => this.showTip(c, tip));
    c.on("pointerout", () => this.hideTip());
    c.on("pointerdown", () => this.bubbleOn(c, Phaser.Utils.Array.GetRandom(["Woof.", "Woof (that's a no on the bonus).", "*sniffs your pitch deck*", "Bark-to-market fit."])));
    const wander = () => {
      if (!c.active) return;
      const pool = [...this.L.hangouts, ...this.L.overflow, ...this.L.corridors.map((y) => ({ x: 1 + Math.random() * (this.L.GW - 2), y }))];
      const t = Phaser.Utils.Array.GetRandom(pool);
      const dist = Math.hypot(t.x - dog.g.x, t.y - dog.g.y);
      body.scaleX = t.x - dog.g.x - (t.y - dog.g.y) >= 0 ? 1 : -1;
      dog.walking = true;
      this.tweens.add({
        targets: dog.g,
        x: t.x,
        y: t.y,
        duration: Math.max(200, dist * 800),
        onUpdate: () => this.place(dog),
        onComplete: () => {
          dog.walking = false;
          this.time.delayedCall(Phaser.Math.Between(2000, 7000), wander);
        },
      });
    };
    wander();
  }

  // ---------- speech bubbles (own top layer, follow their speaker) ----------

  private layoutBubbles() {
    const placed: Phaser.Geom.Rectangle[] = [];
    for (const b of this.bubbles) {
      const bounds = b.box.getBounds();
      const w = bounds.width / b.box.scaleX || bounds.width;
      const h = bounds.height / b.box.scaleY || bounds.height;
      let y = b.target.y - b.offset;
      const x = b.target.x;
      for (let guard = 0; guard < 8; guard++) {
        const r = new Phaser.Geom.Rectangle(x - w / 2, y - h, w, h);
        const hit = placed.find((o) => Phaser.Geom.Intersects.RectangleToRectangle(o, r));
        if (!hit) break;
        y = hit.y - 4;
      }
      b.box.setPosition(x, y);
      placed.push(new Phaser.Geom.Rectangle(x - w / 2, y - h, w, h));
    }
  }

  private bubbleOn(target: Phaser.GameObjects.Container, text: string, dark = false, who = "") {
    const t = this.txt(0, 0, text, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "10.5px",
      color: dark ? "#ffffff" : "#2b2d42",
      wordWrap: { width: 130 },
      align: "center",
      lineSpacing: -1,
    }).setOrigin(0.5, 1);
    const meta = who
      ? this.txt(0, 0, who, { fontFamily: "system-ui, sans-serif", fontSize: "8.5px", color: dark ? "#b8c0d6" : "#7a8194", align: "center" }).setOrigin(0.5, 1)
      : null;
    const padX = 6, padY = 4;
    const tw = Math.max(t.width, meta?.width ?? 0);
    const th = t.height + (meta ? meta.height + 1 : 0);
    if (meta) t.setY(-meta.height - 1);
    const bg = this.add.graphics();
    const w = tw + padX * 2, h = th + padY * 2;
    bg.fillStyle(dark ? 0x2b2d42 : 0xffffff, 0.97).fillRoundedRect(-w / 2, -h + padY, w, h, 7);
    bg.lineStyle(1.2, INK, 0.85).strokeRoundedRect(-w / 2, -h + padY, w, h, 7);
    bg.fillStyle(dark ? 0x2b2d42 : 0xffffff, 0.97).fillTriangle(-4, padY - 0.5, 4, padY - 0.5, 0, padY + 5);
    bg.lineStyle(1.2, INK, 0.85).lineBetween(-4, padY, 0, padY + 5).lineBetween(4, padY, 0, padY + 5);
    const offset = this.remote ? 86 : 56;
    const box = this.add.container(target.x, target.y - offset, meta ? [bg, t, meta] : [bg, t]).setDepth(55_000);
    const bubble: Bubble = { target, box, offset };
    this.bubbles.push(bubble);
    const k = this.uiScale();
    box.setScale(0.4 * k).setAlpha(0);
    this.tweens.add({ targets: box, scale: k, alpha: 1, duration: 200, ease: "Back.out" });
    this.time.delayedCall(3800 + text.length * 40, () =>
      this.tweens.add({
        targets: box,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          this.bubbles = this.bubbles.filter((b) => b !== bubble);
          box.destroy();
        },
      }),
    );
  }

  bubble(id: number, text: string) {
    const p = this.people.get(id);
    if (p) this.bubbleOn(p.c, text, false, `${p.data.name.split(" ")[0]} · ${titleOf(p.data)}`);
  }

  ceoBubble(text: string) {
    this.bubbleOn(this.ceo, text, true, "You · CEO");
  }

  /** Everyone walks to the all-hands spot (meeting room, event space, auditorium...), then back. */
  gather() {
    if (this.remote) {
      for (const p of this.people.values()) this.time.delayedCall(Math.random() * 1500, () => this.emote(p.c, Phaser.Utils.Array.GetRandom(["🔇", "👋", "😐", "📶", "🫥"])));
      return;
    }
    const a = this.L.gather;
    for (const p of this.people.values()) {
      this.walkTo(p, { x: a.x0 + Math.random() * (a.x1 - a.x0), y: a.y0 + Math.random() * (a.y1 - a.y0) }, () => {
        p.body.scaleX = -1;
        p.timer = this.time.delayedCall(7000 + Math.random() * 2000, () => this.walkTo(p, this.home(p.data), () => this.settle(p)));
      });
    }
  }

  party() {
    const colors = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x8338ec];
    const cam = this.cameras.main;
    for (let i = 0; i < 120; i++) {
      const x = Phaser.Math.Between(cam.worldView.x, cam.worldView.right);
      const r = this.add.rectangle(x, cam.worldView.y - 10, 5, 9, Phaser.Utils.Array.GetRandom(colors)).setDepth(58_000);
      this.tweens.add({
        targets: r,
        y: cam.worldView.bottom + 20,
        x: x + Phaser.Math.Between(-60, 60),
        angle: Phaser.Math.Between(-540, 540),
        duration: Phaser.Math.Between(1800, 3600),
        delay: Phaser.Math.Between(0, 900),
        onComplete: () => r.destroy(),
      });
    }
    for (const p of this.people.values()) this.time.delayedCall(Math.random() * 1500, () => this.emote(p.c, Phaser.Utils.Array.GetRandom(["🎉", "🍻", "🕺", "💃", "🥳"])));
    this.gather();
  }

  // ---------- investors visiting for a pitch ----------

  /** Resolves once all investors have arrived (in the meeting room, or on the call). */
  investorsArrive(): Promise<void> {
    this.investorsLeave(false, true);
    const arrivals: Promise<void>[] = [];
    const vests = [0x4a4e69, 0x22223b, 0x9a8c98];
    const firstTile = this.view.headcount + 2;
    this.L.investorSpots.forEach((spot, i) => {
      const f = this.makeFigure({ shirt: vests[i], pants: 0xc9ada7, skin: SKIN[(i * 2) % SKIN.length], hair: HAIR[[5, 3, 0][i]], style: (["bald", "bowl", "spiky"] as const)[i], acc: "glasses" });
      this.drawMouth(f.face, 50);
      const p: Person = {
        data: { id: -1 - i, name: "Investor", role: "VC", quirk: "", moodOffset: 0, desk: -1, talkedQuarter: 0, salary: 0, history: [] },
        ...f,
        g: { ...this.L.door },
        walking: false,
        seated: false,
        phase: i,
        lastMood: 50,
        badge: this.txt(0, 0, "", {}),
      };
      f.c.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
      f.c.on("pointerover", () => this.showTip(f.c, ["Partner · fleece vest, 3 board seats", "Associate · has read one book about blitzscaling", "Managing Partner · asks about TAM, then about AI"][i]));
      f.c.on("pointerout", () => this.hideTip());
      this.visitors.push(p);
      if (this.remote) {
        this.zoomTile(firstTile + i, ["VC Partner (Patagonia)", "VC Associate", "Managing Partner"][i], 0xdee2e6);
        this.placeInTile(f.c, firstTile + i);
        f.body.scaleX = 1;
        arrivals.push(
          new Promise((resolve) =>
            this.time.delayedCall(300 + i * 300, () => {
              this.emote(f.c, ["🧐", "📱", "🥤"][i]);
              resolve();
            }),
          ),
        );
        return;
      }
      this.place(p);
      arrivals.push(
        new Promise((resolve) =>
          this.time.delayedCall(i * 250, () =>
            this.walkTo(
              p,
              spot,
              () => {
                p.body.scaleX = 1;
                this.emote(p.c, ["🧐", "📱", "🥤"][i]);
                resolve();
              },
              300,
            ),
          ),
        ),
      );
    });
    return Promise.all(arrivals).then(() => undefined);
  }

  investorsLeave(happy: boolean, instant = false) {
    const leaving = this.visitors;
    this.visitors = [];
    leaving.forEach((p, i) => {
      if (instant) return p.c.destroy();
      this.drawMouth(p.face, happy ? 90 : 20);
      this.emote(p.c, happy ? "🤑" : "🥱");
      if (this.remote) {
        this.time.delayedCall(1500 + i * 300, () => this.tweens.add({ targets: p.c, alpha: 0, duration: 400, onComplete: () => p.c.destroy() }));
        return;
      }
      this.time.delayedCall(1200 + i * 300, () =>
        this.walkTo(p, { ...this.L.door }, () => this.tweens.add({ targets: p.c, alpha: 0, duration: 400, onComplete: () => p.c.destroy() })),
      );
    });
  }

  /** Make one person obvious: a hop and a pointer above their head. */
  focus(id: number) {
    const p = this.people.get(id);
    if (!p) return;
    this.tweens.add({ targets: p.body, y: -14, duration: 160, yoyo: true, repeat: 2, ease: "Quad.out" });
    const arrow = this.txt(p.c.x, p.c.y - (this.remote ? 110 : 80), "👇", { fontSize: "20px" }).setOrigin(0.5).setDepth(59_000);
    this.tweens.add({ targets: arrow, y: arrow.y + 8, duration: 300, yoyo: true, repeat: 3, onComplete: () => arrow.destroy() });
  }

  layoffShock() {
    this.cameras.main.shake(300, 0.004);
    for (const p of this.people.values()) this.time.delayedCall(Math.random() * 800, () => this.emote(p.c, Phaser.Utils.Array.GetRandom(["😱", "😨", "👀"])));
  }

  /** Little celebration when something new appears in the office. */
  sparkle() {
    const cam = this.cameras.main;
    for (let i = 0; i < 8; i++) this.floatEmoji(cam.worldView.centerX + Phaser.Math.Between(-220, 220), cam.worldView.centerY + Phaser.Math.Between(-140, 140), "✨");
  }
}
