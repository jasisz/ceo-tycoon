// Isometric office drawn entirely with Phaser Graphics - no external assets.
// The canvas renders at native device resolution; the camera zooms the fixed
// world (WORLD_W x WORLD_H) to fit, so vector shapes stay crisp at any size.
import Phaser from "phaser";
import type { Employee } from "../game/state";

const TW = 64; // tile width
const TH = 32; // tile height
const GW = 14; // grid width (x)
const GH = 10; // grid height (y)
const WALL = 78;
const OX = GH * (TW / 2) + 40;
const OY = WALL + 50;
const WORLD_W = (GW + GH) * (TW / 2) + 80;
const WORLD_H = (GW + GH) * (TH / 2) + WALL + 90;

const INK = 0x2b2d42; // cartoon outline colour

// desk grid positions (index = desk slot)
const DESKS: [number, number][] = [
  [5, 2], [7, 2], [9, 2],
  [5, 4], [7, 4], [9, 4],
  [5, 6], [7, 6], [9, 6],
  [5, 8], [7, 8], [9, 8],
  [11.5, 6], [11.5, 8],
];
// vertical aisles between desk columns and the horizontal corridor above them
const AISLES = [4.5, 6.55, 8.55, 10.75];
const CORRIDOR_Y = 1.35;
const CORRIDORS = [CORRIDOR_Y, 9.4];
const COFFEE: [number, number] = [12.45, 1.3];
const DOOR: [number, number] = [13.4, 9.5];
const HANGOUTS: [number, number][] = [[11.6, 2.4], [12.6, 2.6], [2.2, 3.4], [3.3, 3.3], [7.5, 0.9], [3.6, 6.3], [1.2, 6.0]];

const SHIRTS = [0xef476f, 0x118ab2, 0xffd166, 0x06d6a0, 0x8338ec, 0xff8c42, 0x3a86ff, 0xe63946, 0x2a9d8f, 0xf15bb5];
const PANTS = [0x3d405b, 0x264653, 0x5c4d7d, 0x463f3a, 0x1d3557];
const SKIN = [0xffd8b1, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524];
const HAIR = [0x2b2118, 0x5a3825, 0xd4a017, 0xb5523b, 0x1a1a1a, 0x9e9e9e, 0xff6fb5, 0x4cc9f0];
const HAIRSTYLES = ["bowl", "spiky", "bun", "bald", "long", "mohawk", "curly"] as const;
const ACCESSORIES = ["none", "none", "glasses", "headphones", "beard", "cap", "none", "glasses"] as const;
const LOW_EMOTES = ["💢", "😤", "🙄", "💀", "😩", "🫠"];
const MID_EMOTES = ["☕", "🤔", "📊", "🫡", "💬"];
const HIGH_EMOTES = ["✨", "🎉", "💪", "🚀", "😎"];

interface Pt {
  x: number;
  y: number;
}

interface Person {
  data: Employee;
  c: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Container;
  legL: Phaser.GameObjects.Graphics;
  legR: Phaser.GameObjects.Graphics;
  face: Phaser.GameObjects.Graphics;
  eyes: Phaser.GameObjects.Graphics;
  skin: number;
  g: Pt;
  walking: boolean;
  seated: boolean;
  phase: number;
  timer?: Phaser.Time.TimerEvent;
  lastMood: number;
}

interface Bubble {
  target: Phaser.GameObjects.Container;
  box: Phaser.GameObjects.Container;
  offset: number;
}

export interface OfficeCallbacks {
  onEmployeeClick: (id: number) => void;
  onCeoClick: () => void;
  getMood: (id: number) => number;
  onReady: (scene: OfficeScene) => void;
}

export class OfficeScene extends Phaser.Scene {
  private people = new Map<number, Person>();
  private bubbles: Bubble[] = [];
  private cb!: OfficeCallbacks;
  private tooltip!: Phaser.GameObjects.Text;
  private ceo!: Phaser.GameObjects.Container;
  private dog!: { c: Phaser.GameObjects.Container; g: Pt; walking: boolean };
  private visitors: Person[] = [];
  private res = 1;

  constructor() {
    super("office");
  }

  init(data: { cb: OfficeCallbacks }) {
    this.cb = data.cb;
  }

  iso(gx: number, gy: number): Pt {
    return { x: OX + (gx - gy) * (TW / 2), y: OY + (gx + gy) * (TH / 2) };
  }

  /** Crisp text: rasterised at the camera's zoom. */
  private txt(x: number, y: number, s: string, style: Phaser.Types.GameObjects.Text.TextStyle) {
    return this.add.text(x, y, s, { resolution: this.res, ...style });
  }

  create() {
    this.fitCamera();
    this.scale.on("resize", () => this.fitCamera());
    this.drawRoom();
    this.tooltip = this.txt(0, 0, "", {
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      color: "#fff",
      backgroundColor: "#2b2d42ee",
      padding: { x: 6, y: 3 },
    })
      .setDepth(60_000)
      .setVisible(false);
    this.spawnDog();
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.randomEmote() });
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.coffeeSteam() });
    this.cb.onReady(this);
  }

  private fitCamera() {
    const cam = this.cameras.main;
    const zoom = Math.min(this.scale.width / WORLD_W, this.scale.height / WORLD_H);
    cam.setZoom(zoom);
    cam.centerOn(WORLD_W / 2, WORLD_H / 2 - 10);
    this.res = Math.max(1, Math.ceil(zoom * 2) / 2);
  }

  update(time: number) {
    for (const p of this.people.values()) this.animatePerson(p, time);
    for (const p of this.visitors) this.animatePerson(p, time);
    if (this.dog?.walking) {
      const s = Math.sin(time / 60);
      (this.dog.c.getAt(1) as Phaser.GameObjects.Container).y = Math.abs(s) * -2;
    }
    this.layoutBubbles();
  }

  /** Follow speakers and push overlapping bubbles upward so they never cover each other. */
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

  // ---------- drawing helpers ----------

  private poly(g: Phaser.GameObjects.Graphics, pts: Pt[], fill: number, outline = true, alpha = 1) {
    g.fillStyle(fill, alpha).fillPoints(pts, true);
    if (outline) g.lineStyle(1.5, INK, 0.9).strokePoints(pts, true, true);
  }

  private tile(g: Phaser.GameObjects.Graphics, gx: number, gy: number, color: number) {
    const pts = [this.iso(gx, gy), this.iso(gx + 1, gy), this.iso(gx + 1, gy + 1), this.iso(gx, gy + 1)];
    g.fillStyle(color, 1).fillPoints(pts, true);
    g.lineStyle(1, 0xffffff, 0.35).strokePoints(pts, true, true);
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

  private drawRoom() {
    const g = this.add.graphics().setDepth(0);
    for (let x = 0; x < GW; x++)
      for (let y = 0; y < GH; y++) {
        const odd = (x + y) % 2 === 1;
        let col = odd ? 0xc5cee0 : 0xd0d8e8; // open space carpet
        if (x < 4 && y < 4) col = odd ? 0x9fd8b5 : 0xb0e0c2; // meeting room
        if (x < 4 && y >= 6) col = odd ? 0xc08b5c : 0xcc9a6c; // CEO office parquet
        if (x >= 11 && y < 4) col = odd ? 0xffe8b8 : 0xfff1d0; // kitchen
        if (x < 4 && y >= 4 && y < 6) col = odd ? 0xf6bd60 : 0xf7c873; // "chill zone"
        this.tile(g, x, y, col);
      }
    // floor outline
    g.lineStyle(2, INK, 0.9).strokePoints([this.iso(0, 0), this.iso(GW, 0), this.iso(GW, GH), this.iso(0, GH)], true, true);

    // walls
    const w = this.add.graphics().setDepth(0);
    this.wallPoly(w, this.iso(0, 0), this.iso(0, GH), 0, WALL, 0xb8c0ff);
    this.wallPoly(w, this.iso(0, 0), this.iso(GW, 0), 0, WALL, 0xc8d0ff);
    this.wallPoly(w, this.iso(0, 0), this.iso(0, GH), WALL - 6, WALL, 0x8e94f2); // trim
    this.wallPoly(w, this.iso(0, 0), this.iso(GW, 0), WALL - 6, WALL, 0x9fa6f5);
    // windows with a skyline
    for (const i of [5, 8.2]) {
      this.wallPoly(w, this.iso(i, 0), this.iso(i + 2.2, 0), 22, 62, 0xa2d2ff);
      for (let k = 0; k < 5; k++) {
        const a = this.iso(i + 0.2 + k * 0.42, 0);
        const bh = 10 + ((k * 37 + i * 11) % 22);
        w.fillStyle(0x7b8cde, 0.55).fillRect(a.x - 4, a.y - 22 - bh, 7, bh);
      }
    }
    // posters
    this.wallPoly(w, this.iso(0, 6.4), this.iso(0, 8.4), 22, 60, 0xffd166);
    this.wallText("left", 7.4, 41, "HUSTLE", "#2b2d42", 13);
    this.wallPoly(w, this.iso(0, 4.3), this.iso(0, 5.8), 26, 58, 0xffffff);
    this.wallText("left", 5.05, 48, "LIVE LAUGH", "#ef476f", 8);
    this.wallText("left", 5.05, 37, "LEVERAGE", "#ef476f", 9);
    this.wallPoly(w, this.iso(0, 1.0), this.iso(0, 3.2), 18, 60, 0xffffff); // whiteboard
    const wb = [0.15, 0.35, 0.5, 0.7, 0.9].map((f, i) => {
      const q = this.iso(0, 1.3 + f * 1.6);
      return { x: q.x, y: q.y - [24, 30, 27, 38, 52][i] };
    });
    w.lineStyle(2, 0x06d6a0).strokePoints(wb, false, false);
    this.wallText("left", 2.1, 54, "Q4: 📈 TO THE MOON", "#118ab2", 7);
    // neon sign on back wall
    this.wallText("back", 2.6, 46, "move fast & break payroll", "#ff4fd8", 10).setShadow(0, 0, "#ff4fd8", 8, false, true);
    this.wallPoly(w, this.iso(11.2, 0), this.iso(12.4, 0), 30, 54, 0xffffff); // "employee of the month"
    this.wallText("back", 11.8, 47, "EMPLOYEE OF", "#2b2d42", 6);
    this.wallText("back", 11.8, 40, "THE MONTH:", "#2b2d42", 6);
    this.wallText("back", 11.8, 33, "the CEO", "#e63946", 7);

    this.label(2, 0.35, "MEETING ROOM");
    this.label(12.5, 3.75, "KITCHEN");
    this.label(2, 9.65, "CEO OFFICE");
    this.label(7, 9.8, "OPEN SPACE");
    this.label(2, 5.85, "CHILL ZONE");

    // glass partitions
    const glass = this.add.graphics().setDepth(2);
    const pane = (x1: number, y1: number, x2: number, y2: number) => {
      const a = this.iso(x1, y1), b = this.iso(x2, y2);
      glass.fillStyle(0xdff6ff, 0.18).fillPoints([a, b, { x: b.x, y: b.y - 34 }, { x: a.x, y: a.y - 34 }], true);
      glass.lineStyle(1.5, INK, 0.5).lineBetween(a.x, a.y - 34, b.x, b.y - 34);
    };
    pane(4, 0, 4, 2.6); pane(0, 4, 2.8, 4);
    pane(4, 6, 4, 6.8); pane(4, 8.2, 4, 10); pane(0, 6, 2.8, 6);

    // meeting table
    this.box(1, 1.3, 2, 1.3, 14, 0xf4f1de);
    // kitchen counter, coffee machine, fridge, water cooler
    this.box(11, 0.1, 2.1, 0.75, 24, 0xe9edc9);
    this.box(12.2, 0.2, 0.5, 0.45, 22, 0x3d405b, 24);
    this.box(13.2, 0.15, 0.7, 0.75, 64, 0xf8f9fa);
    const cooler = this.iso(10.6, 0.5);
    this.box(10.4, 0.3, 0.4, 0.4, 26, 0xdee2e6);
    this.add.ellipse(cooler.x, cooler.y - 34, 14, 18, 0x9bf6ff, 0.85).setStrokeStyle(1.5, INK, 0.8).setDepth(cooler.y + 1);
    // ping-pong table (with net) in the chill zone
    this.box(1, 4.4, 1.8, 1, 12, 0x2a9d8f);
    const n1 = this.iso(1.9, 4.4), n2 = this.iso(1.9, 5.4);
    this.add.graphics().setDepth(this.iso(1.9, 4.9).y + 1).lineStyle(2, 0xffffff).lineBetween(n1.x, n1.y - 16, n2.x, n2.y - 16);
    // beanbags
    for (const [x, y, c] of [[3.2, 4.4, 0xef476f], [3.4, 5.3, 0x3a86ff]] as [number, number, number][]) {
      const p = this.iso(x, y);
      this.add.ellipse(p.x, p.y - 6, 30, 20, c).setStrokeStyle(1.5, INK, 0.9).setDepth(p.y);
    }
    this.plant(4.25, 0.2, "tall");
    this.plant(10.4, 9.4, "bush");
    this.plant(0.25, 3.5, "cactus");
    this.plant(13.4, 4.3, "tall");
    this.plant(3.4, 9.4, "cactus");

    // desks with monitors, chairs and random clutter
    const screens = [0x3a86ff, 0x06d6a0, 0x8338ec, 0xff006e, 0x2b2d42];
    DESKS.forEach(([x, y], i) => {
      this.chair(x + 0.55, y + 0.95, [0xef476f, 0x118ab2, 0x06d6a0, 0x8338ec][i % 4]);
      this.box(x, y, 1.1, 0.6, 16, 0xffffff);
      const mon = this.box(x + 0.35, y + 0.05, 0.42, 0.08, 16, screens[i % screens.length], 16);
      mon.setDepth(this.iso(x + 0.55, y + 0.3).y + 0.5);
      const top = this.iso(x + 0.95, y + 0.4);
      const clutter = ["☕", "🦆", "🧃", "📎", "🪴", "🍕"][i % 6];
      this.txt(top.x, top.y - 20, clutter, { fontSize: "10px" }).setOrigin(0.5).setDepth(this.iso(x + 0.55, y + 0.3).y + 0.6);
    });
    // CEO desk (huge, mahogany) with a nameplate and a golden statue of themselves
    this.box(0.9, 7.1, 2, 0.85, 18, 0x9c6644);
    const plate = this.iso(1.9, 7.95);
    this.txt(plate.x, plate.y - 9, "CHIEF", { fontFamily: "Impact, sans-serif", fontSize: "7px", color: "#ffd166" }).setOrigin(0.5).setDepth(plate.y + 1);
    const statue = this.iso(1.2, 7.4);
    this.txt(statue.x, statue.y - 26, "🏆", { fontSize: "14px" }).setOrigin(0.5).setDepth(statue.y + 1);

    this.ceo = this.makeFigure({ shirt: 0x2b2d42, pants: 0x1a1a2e, skin: 0xffd8b1, hair: 0x1a1a1a, style: "bowl", acc: "none", ceo: true }).c;
    const cp = this.iso(2.1, 8.6);
    this.ceo.setPosition(cp.x, cp.y).setDepth(cp.y);
    this.ceo.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
    this.ceo.on("pointerdown", () => this.cb.onCeoClick());
    this.ceo.on("pointerover", () => this.showTip(this.ceo, "You, the CEO. Click for your secret finances 🕶️"));
    this.ceo.on("pointerout", () => this.hideTip());
    this.tweens.add({ targets: this.ceo, angle: { from: -3, to: 3 }, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    this.setOffshore(0);
  }

  private chair(gx: number, gy: number, color: number) {
    const p = this.iso(gx, gy);
    const g = this.add.graphics().setDepth(p.y + 0.4);
    g.lineStyle(2, INK, 0.9);
    for (const a of [0, 1.26, 2.51, 3.77, 5.03]) g.lineBetween(p.x, p.y - 2, p.x + Math.cos(a) * 9, p.y - 2 + Math.sin(a) * 4);
    g.lineBetween(p.x, p.y - 2, p.x, p.y - 9);
    g.fillStyle(this.shade(color, 0.8)).fillRoundedRect(p.x - 9, p.y - 34, 18, 20, 6).lineStyle(1.5, INK).strokeRoundedRect(p.x - 9, p.y - 34, 18, 20, 6);
    g.fillStyle(color).fillEllipse(p.x, p.y - 11, 22, 9).strokeEllipse(p.x, p.y - 11, 22, 9);
  }

  // ---------- the "totally normal office safe" that grows with the offshore account ----------

  private safe?: Phaser.GameObjects.Container;
  private safeAmount = -1;

  setOffshore(amount: number) {
    if (amount === this.safeAmount) return;
    const grew = this.safeAmount >= 0 && amount > this.safeAmount;
    this.safeAmount = amount;
    this.safe?.destroy();
    const gx = 0.25, gy = 8.9;
    const h = 20 + Math.min(70, (amount / 1_000_000) * 18);
    const g = this.box(gx, gy, 0.7, 0.7, h, 0x6c757d);
    const top = this.iso(gx + 0.35, gy + 0.35);
    const front = this.iso(gx + 0.35, gy + 0.7);
    const dial = this.add.graphics();
    dial.fillStyle(0xffd166).fillCircle(front.x - 9, front.y - h / 2, 4).lineStyle(1.5, INK).strokeCircle(front.x - 9, front.y - h / 2, 4);
    const sign = this.txt(front.x - 9, front.y - h / 2 - 12, "Zug", { fontFamily: "Impact, sans-serif", fontSize: "7px", color: "#ffd166" }).setOrigin(0.5);
    const items: Phaser.GameObjects.GameObject[] = [g, dial, sign];
    const bags = Math.min(6, Math.floor(amount / 250_000));
    for (let i = 0; i < bags; i++) {
      items.push(this.txt(top.x - 10 + (i % 3) * 10, top.y - h - 6 - Math.floor(i / 3) * 9, "💰", { fontSize: "11px" }).setOrigin(0.5));
    }
    this.safe = this.add.container(0, 0, items).setDepth(top.y + 1);
    const zone = this.add.zone(top.x, top.y - h / 2, 40, h + 20).setInteractive();
    this.safe.add(zone);
    zone.on("pointerover", () => {
      this.tooltip.setText(amount ? `Totally normal office safe · ${(amount / 1e6).toFixed(2)}M of "consulting"` : "Totally normal, empty office safe").setPosition(top.x + 20, top.y - h - 30).setVisible(true);
    });
    zone.on("pointerout", () => this.hideTip());
    if (grew) this.tweens.add({ targets: this.safe, scaleY: { from: 0.9, to: 1 }, duration: 300, ease: "Back.out" });
  }

  /** Banknotes fly from the open space into the safe. */
  moneyFly() {
    const to = this.iso(0.6, 9.2);
    for (let i = 0; i < 14; i++) {
      const from = this.iso(6 + Math.random() * 5, 3 + Math.random() * 5);
      const t = this.txt(from.x, from.y - 30, "💸", { fontSize: "14px" }).setOrigin(0.5).setDepth(57_000);
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

  private makeFigure(o: {
    shirt: number;
    pants: number;
    skin: number;
    hair: number;
    style: (typeof HAIRSTYLES)[number];
    acc: (typeof ACCESSORIES)[number];
    ceo?: boolean;
  }) {
    const c = this.add.container(0, 0);
    const body = this.add.container(0, 0);
    const shadow = this.add.ellipse(0, 0, 22, 8, 0x000000, 0.18);

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
    // arms
    torso.fillStyle(this.shade(o.shirt, 0.85)).fillEllipse(-11, -17, 6, 12).strokeEllipse(-11, -17, 6, 12);
    torso.fillEllipse(11, -17, 6, 12).strokeEllipse(11, -17, 6, 12);
    torso.fillStyle(o.skin).fillCircle(-11, -11, 2.6).fillCircle(11, -11, 2.6);
    if (o.ceo) {
      torso.fillStyle(0xffffff).fillTriangle(-4, -26, 4, -26, 0, -19);
      torso.fillStyle(0xe63946).fillTriangle(-2, -22, 2, -22, 0, -10).lineStyle(1, INK).strokeTriangle(-2, -22, 2, -22, 0, -10);
      torso.lineStyle(1.5, 0xffd166).beginPath().arc(0, -24, 6, 0.3, Math.PI - 0.3).strokePath(); // gold chain
    }

    const head = this.add.graphics();
    const hy = -40;
    // hair behind head
    if (o.style === "long") head.fillStyle(o.hair).fillRoundedRect(-12, hy - 6, 24, 22, 8);
    if (o.style === "bun") head.fillStyle(o.hair).fillCircle(0, hy - 14, 6).lineStyle(1.5, INK).strokeCircle(0, hy - 14, 6);
    head.fillStyle(o.skin).fillCircle(0, hy, 12).lineStyle(1.5, INK).strokeCircle(0, hy, 12);
    head.fillStyle(this.shade(o.skin, 0.95)).fillCircle(-12, hy + 1, 3).fillCircle(12, hy + 1, 3); // ears
    head.fillStyle(0xff8fab, 0.45).fillCircle(-6, hy + 5, 2.6).fillCircle(6, hy + 5, 2.6); // blush
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
    eyes.y = 0;
    const face = this.add.graphics();
    const extra = this.add.graphics();
    extra.lineStyle(1.5, INK);
    switch (o.ceo ? "shades" : o.acc) {
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
      const coffee = this.txt(14, -22, "☕", { fontSize: "11px" }).setOrigin(0.5);
      body.add(coffee);
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
      face.lineBetween(-7, hy - 5, -2, hy - 3).lineBetween(7, hy - 5, 2, hy - 3); // angry brows
    }
  }

  private showTip(obj: Phaser.GameObjects.Container, text: string) {
    this.tooltip.setText(text).setPosition(obj.x + 14, obj.y - 76).setVisible(true);
    this.input.setDefaultCursor("pointer");
  }

  private hideTip() {
    this.tooltip.setVisible(false);
    this.input.setDefaultCursor("default");
  }

  // ---------- people ----------

  private seat(desk: number): Pt {
    const [x, y] = DESKS[desk];
    return { x: x + 0.55, y: y + 0.95 };
  }

  private place(p: { c: Phaser.GameObjects.Container; g: Pt }) {
    const s = this.iso(p.g.x, p.g.y);
    p.c.setPosition(s.x, s.y).setDepth(s.y + 0.8);
  }

  sync(employees: Employee[]) {
    const ids = new Set(employees.map((e) => e.id));
    for (const id of [...this.people.keys()]) if (!ids.has(id)) this.leave(id);
    for (const e of employees) {
      const p = this.people.get(e.id);
      if (p) {
        p.data = e;
        const m = this.cb.getMood(e.id);
        if (Math.abs(m - p.lastMood) > 0) {
          this.drawMouth(p.face, m);
          p.lastMood = m;
        }
      } else this.spawn(e);
    }
  }

  private spawn(e: Employee) {
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
    const p: Person = { data: e, ...f, skin: 0, g: { x: DOOR[0], y: DOOR[1] }, walking: false, seated: false, phase: Math.random() * 10, lastMood: mood };
    this.people.set(e.id, p);
    this.place(p);
    f.c.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
    f.c.on("pointerdown", () => this.cb.onEmployeeClick(e.id));
    f.c.on("pointerover", () => this.showTip(f.c, `${p.data.name} · ${p.data.role}`));
    f.c.on("pointerout", () => this.hideTip());
    // blink
    this.time.addEvent({
      delay: 2500 + Math.random() * 3000,
      loop: true,
      callback: () => {
        if (!p.c.active) return;
        this.tweens.add({ targets: p.eyes, scaleY: 0.1, y: -40 * 0.9, duration: 70, yoyo: true });
      },
    });
    this.walkTo(p, this.seat(e.desk), () => this.sitDown(p));
  }

  private animatePerson(p: Person, time: number) {
    const t = time / 110 + p.phase;
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
    const aisle = (x: number) => AISLES.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    const inDeskArea = (q: Pt) => q.x > 4.3 && q.x < 12.8 && q.y > 1.7 && q.y < 9.1;
    if (!inDeskArea(from) && !inDeskArea(to)) return [to];
    const cy = CORRIDORS.reduce((a, b) => (Math.abs(from.y - b) + Math.abs(to.y - b) < Math.abs(from.y - a) + Math.abs(to.y - a) ? b : a));
    const ax1 = inDeskArea(from) ? aisle(from.x) : from.x;
    const ax2 = inDeskArea(to) ? aisle(to.x) : to.x < 4.3 ? 4.5 : to.x;
    const pts: Pt[] = [{ x: ax1, y: from.y }, { x: ax1, y: cy }, { x: ax2, y: cy }, { x: ax2, y: to.y }, to];
    return pts.filter((q, i, arr) => Math.hypot(q.x - (i ? arr[i - 1].x : from.x), q.y - (i ? arr[i - 1].y : from.y)) > 0.05);
  }

  private walkTo(p: Person, to: Pt, done?: () => void, msPerTile = 380) {
    p.timer?.remove();
    this.tweens.killTweensOf(p.g);
    p.seated = false;
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

  private sitDown(p: Person) {
    p.seated = true;
    p.body.scaleX = -1;
    this.idle(p);
  }

  private idle(p: Person) {
    p.timer = this.time.delayedCall(Phaser.Math.Between(5000, 16000), () => {
      if (!this.people.has(p.data.id)) return;
      const target =
        Math.random() < 0.5
          ? { x: COFFEE[0] - 0.4 + Math.random() * 0.7, y: COFFEE[1] + 0.6 + Math.random() * 0.5 }
          : (() => {
              const [x, y] = Phaser.Utils.Array.GetRandom(HANGOUTS);
              return { x: x + Math.random() * 0.4, y: y + Math.random() * 0.4 };
            })();
      this.walkTo(p, target, () => {
        if (Math.random() < 0.4) this.emote(p.c, target.y < 2 ? "☕" : this.moodEmote(p.lastMood));
        p.timer = this.time.delayedCall(Phaser.Math.Between(2000, 5000), () => this.walkTo(p, this.seat(p.data.desk), () => this.sitDown(p)));
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
    if (p.seated && p.lastMood < 30 && Math.random() < 0.6) this.emote(p.c, "💤");
    else if (Math.random() < 0.5) this.emote(p.c, this.moodEmote(p.lastMood));
  }

  emote(target: Phaser.GameObjects.Container, e: string) {
    const t = this.txt(target.x, target.y - 62, e, { fontSize: "16px" }).setOrigin(0.5).setDepth(50_000).setScale(0.3);
    this.tweens.add({ targets: t, scale: 1, duration: 220, ease: "Back.out" });
    this.tweens.add({ targets: t, y: t.y - 22, alpha: 0, delay: 900, duration: 700, onComplete: () => t.destroy() });
  }

  private coffeeSteam() {
    const p = this.iso(12.45, 0.42);
    const s = this.add.circle(p.x + Phaser.Math.Between(-2, 2), p.y - 48, 3, 0xffffff, 0.8).setDepth(p.y + 50);
    this.tweens.add({ targets: s, y: s.y - 20, alpha: 0, scale: 2.2, duration: 1600, onComplete: () => s.destroy() });
  }

  leave(id: number) {
    const p = this.people.get(id);
    if (!p) return;
    this.people.delete(id);
    p.timer?.remove();
    this.drawMouth(p.face, 10);
    this.bubbleOn(p.c, Phaser.Utils.Array.GetRandom(["Bye.", "Good luck with the IPO lol", "Taking my stapler.", "See you on LinkedIn.", "I'm keeping the hoodie."]));
    this.walkTo(p, { x: DOOR[0], y: DOOR[1] }, () =>
      this.tweens.add({
        targets: p.c,
        alpha: 0,
        duration: 400,
        onComplete: () => {
          this.bubbles = this.bubbles.filter((b) => b.target !== p.c);
          p.c.destroy();
        },
      }),
    );
  }

  // ---------- dog ----------

  private spawnDog() {
    const c = this.add.container(0, 0);
    const body = this.add.container(0, 0);
    const g = this.add.graphics();
    g.lineStyle(1.5, INK).fillStyle(0xc68642);
    g.fillEllipse(0, -8, 22, 12).strokeEllipse(0, -8, 22, 12);
    g.fillCircle(10, -15, 7).strokeCircle(10, -15, 7);
    g.fillStyle(0x8d5524).fillEllipse(6, -18, 5, 9).fillEllipse(14, -18, 5, 9);
    g.fillStyle(INK).fillCircle(12, -16, 1.4).fillCircle(16, -13, 1.8);
    g.lineStyle(2, 0xc68642).lineBetween(-10, -10, -15, -16);
    g.fillStyle(0xe63946).fillRect(5, -11, 8, 2); // collar
    body.add(g);
    c.add([this.add.ellipse(0, 0, 22, 6, 0x000000, 0.15), body]);
    this.dog = { c, g: { x: 3, y: 5 }, walking: false };
    this.place(this.dog);
    c.setInteractive(new Phaser.Geom.Rectangle(-12, -24, 30, 26), Phaser.Geom.Rectangle.Contains);
    c.on("pointerover", () => this.showTip(c, "Biscuit · Chief Happiness Officer (has more equity than you)"));
    c.on("pointerout", () => this.hideTip());
    c.on("pointerdown", () => this.bubbleOn(c, Phaser.Utils.Array.GetRandom(["Woof.", "Woof (that's a no on the bonus).", "*sniffs your pitch deck*", "Bark-to-market fit."])));
    const wander = () => {
      const target = { x: 0.5 + Math.random() * 13, y: Math.random() < 0.5 ? CORRIDOR_Y + Math.random() * 0.3 : 4.5 + Math.random() * 5 };
      const t = { x: target.x > 4.3 && target.y > 1.7 ? AISLES[Math.floor(Math.random() * AISLES.length)] : target.x, y: target.y };
      const dist = Math.hypot(t.x - this.dog.g.x, t.y - this.dog.g.y);
      const dxs = t.x - this.dog.g.x - (t.y - this.dog.g.y);
      body.scaleX = dxs >= 0 ? 1 : -1;
      this.dog.walking = true;
      this.tweens.add({
        targets: this.dog.g,
        x: t.x,
        y: t.y,
        duration: dist * 500,
        onUpdate: () => this.place(this.dog),
        onComplete: () => {
          this.dog.walking = false;
          this.time.delayedCall(Phaser.Math.Between(2000, 7000), wander);
        },
      });
    };
    wander();
  }

  // ---------- speech bubbles (own top layer, follow their speaker) ----------

  private bubbleOn(target: Phaser.GameObjects.Container, text: string, dark = false) {
    const t = this.txt(0, 0, text, {
      fontFamily: "system-ui, sans-serif",
      fontSize: "12px",
      color: dark ? "#ffffff" : "#2b2d42",
      wordWrap: { width: 180 },
      align: "center",
    }).setOrigin(0.5, 1);
    const pad = 7;
    const bg = this.add.graphics();
    const w = t.width + pad * 2, h = t.height + pad * 2;
    bg.fillStyle(dark ? 0x2b2d42 : 0xffffff, 0.97).fillRoundedRect(-w / 2, -h + pad, w, h, 9);
    bg.lineStyle(1.5, INK, 0.9).strokeRoundedRect(-w / 2, -h + pad, w, h, 9);
    bg.fillStyle(dark ? 0x2b2d42 : 0xffffff, 0.97).fillTriangle(-6, pad - 0.5, 6, pad - 0.5, 0, pad + 8);
    bg.lineStyle(1.5, INK, 0.9).lineBetween(-6, pad, 0, pad + 8).lineBetween(6, pad, 0, pad + 8);
    // stack above any bubble this speaker already has
    const offset = 66 + this.bubbles.filter((b) => b.target === target).reduce((acc, b) => acc + (b.box.getBounds().height + 6), 0);
    const box = this.add.container(target.x, target.y - offset, [bg, t]).setDepth(55_000);
    const bubble: Bubble = { target, box, offset };
    this.bubbles.push(bubble);
    box.setScale(0.4).setAlpha(0);
    this.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 200, ease: "Back.out" });
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
    if (p) this.bubbleOn(p.c, text);
  }

  ceoBubble(text: string) {
    this.bubbleOn(this.ceo, text, true);
  }

  /** Everyone walks to the meeting room for an all-hands, then back. */
  gather() {
    for (const p of this.people.values()) {
      this.walkTo(p, { x: 0.6 + Math.random() * 3, y: 0.5 + Math.random() * 0.7 + (Math.random() < 0.5 ? 0 : 2.4) }, () => {
        p.body.scaleX = -1;
        p.timer = this.time.delayedCall(7000 + Math.random() * 2000, () => this.walkTo(p, this.seat(p.data.desk), () => this.sitDown(p)));
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

  /** Resolves once all investors are standing in the meeting room. */
  investorsArrive(): Promise<void> {
    this.investorsLeave(false, true);
    const arrivals: Promise<void>[] = [];
    const spots: Pt[] = [{ x: 1.3, y: 0.8 }, { x: 2.3, y: 0.7 }, { x: 3.3, y: 1.2 }];
    const vests = [0x4a4e69, 0x22223b, 0x9a8c98];
    spots.forEach((spot, i) => {
      const f = this.makeFigure({ shirt: vests[i], pants: 0xc9ada7, skin: SKIN[(i * 2) % SKIN.length], hair: HAIR[[5, 3, 0][i]], style: (["bald", "bowl", "spiky"] as const)[i], acc: "glasses" });
      this.drawMouth(f.face, 50);
      const p: Person = {
        data: { id: -1 - i, name: "Investor", role: "VC", quirk: "", moodOffset: 0, desk: 0, talkedQuarter: 0 },
        ...f,
        skin: 0,
        g: { x: DOOR[0], y: DOOR[1] },
        walking: false,
        seated: false,
        phase: i,
        lastMood: 50,
      };
      f.c.setInteractive(new Phaser.Geom.Rectangle(-14, -56, 28, 58), Phaser.Geom.Rectangle.Contains);
      f.c.on("pointerover", () => this.showTip(f.c, ["Partner · fleece vest, 3 board seats", "Associate · has read one book about blitzscaling", "Managing Partner · asks about TAM, then about AI"][i]));
      f.c.on("pointerout", () => this.hideTip());
      this.visitors.push(p);
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
              150,
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
      this.time.delayedCall(1200 + i * 300, () =>
        this.walkTo(p, { x: DOOR[0], y: DOOR[1] }, () => this.tweens.add({ targets: p.c, alpha: 0, duration: 400, onComplete: () => p.c.destroy() })),
      );
    });
  }

  layoffShock() {
    this.cameras.main.shake(300, 0.004);
    for (const p of this.people.values()) this.time.delayedCall(Math.random() * 800, () => this.emote(p.c, Phaser.Utils.Array.GetRandom(["😱", "😨", "👀"])));
  }
}
