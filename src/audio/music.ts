// Procedural "corporate ukulele" soundtrack (Tone.js, no audio files).
// The arrangement falls apart as morale drops, a heist-movie drone creeps in with
// suspicion, every office has its own sound, and big moments get a jingle.
import * as Tone from "tone";
import type { OfficeTier } from "../game/office";

export interface MusicState {
  morale: number;
  suspicion: number;
  crisis: boolean;
  office: OfficeTier;
}

export type Jingle = "zug" | "party" | "board" | "layoff" | "ipo" | "crisis" | "kaching" | "hire" | "pivot";

// I - V - vi - IV, the chord progression of every stock-music track ever made
const CHORDS = [
  ["C4", "E4", "G4", "C5"],
  ["G3", "D4", "G4", "B4"],
  ["A3", "E4", "A4", "C5"],
  ["F3", "C4", "F4", "A4"],
];
const ROOTS = ["C2", "G1", "A1", "F1"];
const FIFTHS = ["G2", "D2", "E2", "C2"];
// one note per eighth, four bars
const MELODY: (string | null)[] = [
  "E5", null, "G5", null, "A5", "G5", "E5", null,
  "D5", null, "D5", "E5", "D5", null, "B4", null,
  "C5", null, "E5", null, "A5", null, "G5", "E5",
  "F5", "E5", "D5", null, "C5", null, null, null,
];
// strum on these eighths: true = down, false = up
const STRUM: Record<number, boolean> = { 0: true, 2: true, 3: false, 5: false, 6: true, 7: false };

const MUTE_KEY = "ceo-tycoon-muted";

const loadMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

interface Layers {
  uke: boolean;
  sparse: boolean; // only strum on the downbeats
  bass: boolean;
  claps: boolean;
  glock: boolean;
  whistle: boolean;
  kick: boolean;
  pad: boolean;
  epiano: boolean;
  detune: number; // cents of random out-of-tune-ness per string
}

class Music {
  private started = false;
  private starting?: Promise<void>;
  muted = loadMuted();
  private state: MusicState = { morale: 60, suspicion: 0, crisis: false, office: "openspace" };
  private layers: Layers = { uke: true, sparse: false, bass: true, claps: true, glock: true, whistle: false, kick: false, pad: false, epiano: false, detune: 0 };
  private step = 0;

  // graph
  private master!: Tone.Volume;
  private bus!: Tone.Volume; // ducked under jingles
  private color!: Tone.Filter; // per-office tone (lo-fi, phone line...)
  private reverb!: Tone.Reverb;
  private strings: Tone.PluckSynth[] = [];
  private bass!: Tone.MonoSynth;
  private claps!: Tone.NoiseSynth;
  private glock!: Tone.FMSynth;
  private whistle!: Tone.Synth;
  private kick!: Tone.MembraneSynth;
  private pad!: Tone.PolySynth;
  private epiano!: Tone.PolySynth;
  private alarm!: Tone.Synth;
  private drone!: Tone.FatOscillator;
  private droneVol!: Tone.Volume;
  private vinyl!: Tone.Noise;
  private vinylVol!: Tone.Volume;

  /** Must be called from a user gesture (browser autoplay rules). */
  start() {
    this.starting ??= this.boot();
    return this.starting;
  }

  private async boot() {
    await Tone.start();
    this.master = new Tone.Volume(-6).toDestination();
    this.master.mute = this.muted;
    this.reverb = new Tone.Reverb({ decay: 2.4, wet: 0.2 }).connect(this.master);
    this.color = new Tone.Filter(18000, "lowpass").connect(this.reverb);
    this.bus = new Tone.Volume(0).connect(this.color);

    const uke = new Tone.Volume(-6).connect(this.bus);
    this.strings = [0, 1, 2, 3].map(() => new Tone.PluckSynth({ attackNoise: 1.4, dampening: 4200, resonance: 0.9, release: 1 }).connect(uke));
    this.bass = new Tone.MonoSynth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.35, release: 0.3 },
      filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.5, baseFrequency: 180, octaves: 2 },
    }).connect(new Tone.Volume(-11).connect(this.bus));
    const clapFilter = new Tone.Filter(1400, "bandpass").connect(new Tone.Volume(-14).connect(this.bus));
    this.claps = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.11, sustain: 0 } }).connect(clapFilter);
    this.glock = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 10,
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.5 },
      modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
    }).connect(new Tone.Volume(-20).connect(this.bus));
    this.whistle = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.15 } }).connect(
      new Tone.Vibrato(5.5, 0.12).connect(new Tone.Volume(-17).connect(this.bus)),
    );
    this.kick = new Tone.MembraneSynth({ pitchDecay: 0.03, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).connect(new Tone.Volume(-13).connect(this.bus));
    this.pad = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: 24 }, envelope: { attack: 0.9, decay: 0.5, sustain: 0.7, release: 2 } }).connect(
      new Tone.Filter(1400, "lowpass").connect(new Tone.Volume(-26).connect(this.bus)),
    );
    this.epiano = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 3,
      envelope: { attack: 0.005, decay: 0.8, sustain: 0.2, release: 0.8 },
    }).connect(new Tone.Volume(-15).connect(this.bus));
    this.alarm = new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.05 } }).connect(new Tone.Volume(-30).connect(this.bus));

    // heist-movie drone for suspicion, outside the ducked bus so it never fully goes away
    this.droneVol = new Tone.Volume(-Infinity).connect(this.master);
    const droneFilter = new Tone.Filter(260, "lowpass").connect(this.droneVol);
    new Tone.LFO("0.15hz", 160, 420).connect(droneFilter.frequency).start();
    this.drone = new Tone.FatOscillator("C2", "sawtooth", 18).connect(droneFilter).start();

    // garage vinyl crackle
    this.vinylVol = new Tone.Volume(-Infinity).connect(this.master);
    this.vinyl = new Tone.Noise("brown").connect(this.vinylVol).start();

    const transport = Tone.getTransport();
    transport.bpm.value = 112;
    new Tone.Loop((time) => this.tick(time), "8n").start(0);
    transport.start("+0.05");
    this.started = true;
    this.apply();
  }

  private freq(note: string, cents: number) {
    return Tone.Frequency(note).toFrequency() * Math.pow(2, cents / 1200);
  }

  private tick(time: number) {
    const L = this.layers;
    const s = this.step++;
    const bar = Math.floor(s / 8) % 4;
    const eighth = s % 8;
    const chord = CHORDS[bar];

    if (L.uke && eighth in STRUM && (!L.sparse || eighth === 0 || eighth === 4 || (eighth === 6 && Math.random() < 0.3))) {
      const down = STRUM[eighth];
      const order = down ? [0, 1, 2, 3] : [3, 2, 1, 0];
      order.forEach((stringIdx, i) => {
        const cents = L.detune ? (Math.random() * 2 - 1) * L.detune : 0;
        this.strings[stringIdx].triggerAttack(this.freq(chord[stringIdx], cents), time + i * 0.014 + (L.detune ? Math.random() * 0.02 : 0));
      });
    }
    if (L.epiano && (eighth === 0 || eighth === 4)) this.epiano.triggerAttackRelease(chord.slice(1), "4n", time, 0.6);
    if (L.bass && (eighth === 0 || eighth === 4)) this.bass.triggerAttackRelease(eighth === 0 ? ROOTS[bar] : FIFTHS[bar], "8n", time);
    if (L.claps && (eighth === 2 || eighth === 6)) this.claps.triggerAttackRelease("16n", time);
    if (L.kick && eighth % 2 === 0) this.kick.triggerAttackRelease("C1", "8n", time);
    if (L.pad && eighth === 0) this.pad.triggerAttackRelease(chord.slice(0, 3).map((n) => n.replace(/\d/, (d) => String(Number(d) - 1))), "1m", time, 0.5);

    const note = MELODY[s % 32];
    if (note) {
      if (L.whistle && s % 64 >= 32) this.whistle.triggerAttackRelease(note, "8n", time);
      else if (L.glock || L.epiano) this.glock.triggerAttackRelease(note.replace("5", "6"), "16n", time, 0.7);
    }
    if (this.state.crisis && s % 16 === 0) {
      this.alarm.triggerAttackRelease("A5", "16n", time);
      this.alarm.triggerAttackRelease("E5", "16n", time + 0.18);
    }
  }

  /** Feed the current game state; the arrangement follows it. */
  update(state: MusicState) {
    this.state = state;
    if (this.started) this.apply();
  }

  private apply() {
    const { morale, suspicion, office } = this.state;
    const remote = office === "remote";
    this.layers = {
      uke: !remote,
      sparse: morale < 30,
      bass: morale >= 15,
      claps: morale >= 30 && !remote,
      glock: morale >= 45,
      whistle: morale >= 68,
      kick: office === "cowork" && morale >= 30,
      pad: office === "campus",
      epiano: remote,
      detune: morale < 35 ? Math.round((35 - morale) * 1.6) : 0,
    };
    const bpm = morale >= 65 ? 118 : morale >= 45 ? 112 : morale >= 30 ? 102 : morale >= 15 ? 90 : 78;
    Tone.getTransport().bpm.rampTo(bpm, 2);

    // office colour
    const f = this.color;
    if (remote) {
      f.type = "bandpass"; // tinny Zoom hold music
      f.frequency.rampTo(1100, 1);
      f.Q.value = 0.9;
    } else {
      f.type = "lowpass";
      f.Q.value = 1;
      f.frequency.rampTo(office === "garage" ? 2000 : office === "cowork" ? 3800 : 18000, 1);
    }
    this.reverb.wet.rampTo(office === "campus" ? 0.45 : remote ? 0.05 : office === "garage" ? 0.08 : 0.2, 1);
    this.vinylVol.volume.rampTo(office === "garage" ? -36 : -Infinity, 1);
    this.droneVol.volume.rampTo(suspicion < 40 ? -Infinity : -40 + (suspicion - 40) * 0.5, 2);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.started) this.master.mute = this.muted;
    return this.muted;
  }

  // ---------- jingles ----------

  /** One-shot musical sting; the soundtrack ducks underneath it. */
  play(j: Jingle) {
    if (!this.started || this.muted) return;
    const now = Tone.now() + 0.05;
    const disposables: { dispose(): unknown }[] = [];
    const out = new Tone.Volume(-4).connect(this.master);
    disposables.push(out);
    const mk = <T extends { dispose(): unknown }>(x: T) => (disposables.push(x), x);
    let length = 2.5;
    this.bus.volume.rampTo(-14, 0.08);

    switch (j) {
      case "zug": {
        // alphorn, then a yodel
        const horn = mk(new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.18, decay: 0.2, sustain: 0.75, release: 0.5 } }));
        horn.connect(mk(new Tone.Filter(800, "lowpass")).connect(out));
        horn.triggerAttackRelease("G2", 0.5, now);
        horn.triggerAttackRelease("D3", 0.5, now + 0.55);
        horn.triggerAttackRelease("G3", 0.9, now + 1.1);
        const yodel = mk(new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.05 } }));
        yodel.connect(mk(new Tone.Volume(-6)).connect(out));
        ["G4", "D5", "G4", "D5", "B4", "G5", "D5", "G5"].forEach((n, i) => yodel.triggerAttackRelease(n, 0.09, now + 2.1 + i * 0.1));
        length = 3.2;
        break;
      }
      case "party": {
        const kick = mk(new Tone.MembraneSynth({ octaves: 6, envelope: { attack: 0.001, decay: 0.25, sustain: 0 } })).connect(out);
        const bass = mk(new Tone.MonoSynth({ oscillator: { type: "square" }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.05 } }));
        bass.connect(mk(new Tone.Filter(900, "lowpass")).connect(out));
        const hat = mk(new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.04, sustain: 0 } }));
        hat.connect(mk(new Tone.Filter(7000, "highpass")).connect(mk(new Tone.Volume(-12)).connect(out)));
        for (let i = 0; i < 16; i++) {
          const t = now + i * 0.13;
          if (i % 2 === 0) kick.triggerAttackRelease("C1", "8n", t);
          else hat.triggerAttackRelease("32n", t);
          bass.triggerAttackRelease(i % 2 ? "C3" : "C2", 0.1, t);
        }
        const woo = mk(new Tone.Synth({ oscillator: { type: "sine" } })).connect(mk(new Tone.Volume(-8)).connect(out));
        woo.triggerAttack("C5", now + 1.1);
        woo.frequency.exponentialRampToValueAtTime(Tone.Frequency("C6").toFrequency(), now + 1.5);
        woo.triggerRelease(now + 1.6);
        length = 2.4;
        break;
      }
      case "board": {
        // dun dun DUNNN
        const strings = mk(new Tone.PolySynth(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: 30 }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.8, release: 1 } }));
        strings.connect(mk(new Tone.Filter(700, "lowpass")).connect(out));
        strings.triggerAttackRelease(["C2", "C3"], 0.22, now);
        strings.triggerAttackRelease(["C2", "C3"], 0.22, now + 0.32);
        strings.triggerAttackRelease(["F#2", "F#3", "C3"], 1.6, now + 0.68);
        length = 3;
        break;
      }
      case "layoff": {
        // sad trombone: wah wah wah waaaah
        const vib = mk(new Tone.Vibrato(6, 0));
        const bone = mk(new Tone.Synth({ oscillator: { type: "sawtooth" }, envelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.3 } }));
        bone.connect(mk(new Tone.Filter(1100, "lowpass")).connect(vib.connect(out)));
        ["A#3", "A3", "G#3"].forEach((n, i) => bone.triggerAttackRelease(n, 0.38, now + i * 0.45));
        bone.triggerAttackRelease("G3", 1.4, now + 1.35);
        vib.depth.setValueAtTime(0, now + 1.35);
        vib.depth.linearRampToValueAtTime(0.35, now + 2.2);
        length = 3.2;
        break;
      }
      case "ipo": {
        const bell = mk(new Tone.FMSynth({ harmonicity: 5.07, modulationIndex: 14, envelope: { attack: 0.001, decay: 1.2, sustain: 0, release: 1 } }));
        bell.connect(mk(new Tone.Volume(-6)).connect(out));
        [0, 0.35, 0.7].forEach((t) => bell.triggerAttackRelease("E6", 0.8, now + t));
        const brass = mk(new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 0.04, decay: 0.2, sustain: 0.7, release: 0.6 } }));
        brass.connect(mk(new Tone.Filter(2200, "lowpass")).connect(out));
        ["C4", "E4", "G4"].forEach((n, i) => brass.triggerAttackRelease(n, 0.18, now + 1.2 + i * 0.2));
        brass.triggerAttackRelease(["C4", "E4", "G4", "C5"], 1.4, now + 1.8);
        length = 3.6;
        break;
      }
      case "crisis": {
        const siren = mk(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.01, decay: 0.05, sustain: 0.8, release: 0.05 } }));
        siren.connect(mk(new Tone.Volume(-14)).connect(out));
        for (let i = 0; i < 6; i++) siren.triggerAttackRelease(i % 2 ? "E5" : "A5", 0.22, now + i * 0.25);
        length = 1.8;
        break;
      }
      case "kaching": {
        const coin = mk(new Tone.Synth({ oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.1, sustain: 0.3, release: 0.2 } }));
        coin.connect(mk(new Tone.Volume(-14)).connect(out));
        coin.triggerAttackRelease("B5", 0.08, now);
        coin.triggerAttackRelease("E6", 0.35, now + 0.08);
        length = 0.8;
        break;
      }
      case "hire": {
        const blip = mk(new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.1 } }));
        blip.connect(out);
        ["C5", "E5", "G5"].forEach((n, i) => blip.triggerAttackRelease(n, 0.08, now + i * 0.08));
        length = 0.8;
        break;
      }
      case "pivot": {
        // record scratch
        const bp = mk(new Tone.Filter(2500, "bandpass"));
        bp.Q.value = 3;
        const scratch = mk(new Tone.NoiseSynth({ envelope: { attack: 0.005, decay: 0.25, sustain: 0 } }));
        scratch.connect(bp.connect(out));
        bp.frequency.setValueAtTime(3000, now);
        bp.frequency.exponentialRampToValueAtTime(300, now + 0.25);
        scratch.triggerAttackRelease(0.25, now);
        length = 0.9;
        break;
      }
    }
    setTimeout(() => {
      this.bus.volume.rampTo(0, 0.6);
      setTimeout(() => disposables.forEach((d) => d.dispose()), 1500);
    }, length * 1000);
  }
}

export const music = new Music();
