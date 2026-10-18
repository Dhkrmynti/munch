/**
 * MUNCH's sounds, synthesised like a cheap handheld: square, triangle and noise, the same
 * recipes as the X kit (konten-x/studio/scripts/munch-sfx.mjs). Nothing is sampled or
 * downloaded; each sound is rendered once into a buffer the first time it plays.
 * Browsers only allow audio after a tap or key, so the music (MUNCH's theme, about 1:36,
 * looping) starts on the first one.
 */

type Wave = 'square' | 'tri' | 'noise';
interface Note {
  wave?: Wave;
  at?: number;
  len: number;
  f?: number | ((p: number) => number);
  vol: number;
  decay?: number;
  duty?: number;
}

export type SfxName = 'blip' | 'coin' | 'chomp' | 'crack' | 'tick' | 'nom';

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Each sound: its length in seconds and its notes. */
const RECIPES: Record<SfxName, { sec: number; notes: Note[] }> = {
  // an LCD printing a letter, a menu changing
  blip: { sec: 0.05, notes: [{ f: 1568, len: 0.04, vol: 0.1, decay: 3, duty: 0.25 }] },
  // a $MUNCH coin landing on the screen
  coin: {
    sec: 0.3,
    notes: [
      { f: hz(83), len: 0.06, vol: 0.14 },
      { f: hz(88), at: 0.06, len: 0.22, vol: 0.14, decay: 3 },
    ],
  },
  chomp: {
    sec: 0.16,
    notes: [
      { f: (p) => 180 - 90 * p, len: 0.09, vol: 0.32, decay: 4 },
      { wave: 'noise', len: 0.06, vol: 0.18, decay: 7 },
    ],
  },
  // the shell cracking
  crack: {
    sec: 0.22,
    notes: [
      { wave: 'noise', len: 0.07, vol: 0.34, decay: 5 },
      { f: (p) => 900 - 500 * p, len: 0.09, vol: 0.15, decay: 5, duty: 0.2 },
      { wave: 'noise', at: 0.09, len: 0.1, vol: 0.2, decay: 6 },
    ],
  },
  tick: { sec: 0.08, notes: [{ f: hz(76), len: 0.06, vol: 0.12, decay: 4, duty: 0.125 }] },
  // the attention call: an arpeggio, then two chomps
  nom: {
    sec: 0.8,
    notes: [
      ...[84, 88, 91, 96].map((m, i) => ({ f: hz(m), at: i * 0.075, len: 0.09, vol: 0.11 })),
      ...[0.42, 0.58].map((at) => ({ f: (p: number) => 200 - 90 * p, at, len: 0.12, vol: 0.32 })),
    ],
  },
};

/** One bar of the song: its chord root, the lead (eight 8th notes, null = rest) and how the rest plays. */
interface Bar {
  root: number;
  lead?: (number | null)[];
  /** chord tones for 16th-note arpeggios */
  arp?: number[];
  /** walk: root and octave in 8ths · hold: two long notes · drive: the root in 8ths */
  bass?: 'walk' | 'hold' | 'drive';
  /** 0: none · 1: off-beats · 2: off-beats and soft 16ths */
  hats?: 0 | 1 | 2;
  /** shift the lead by this many semitones */
  up?: number;
  leadVol?: number;
}

// chord tones for the arpeggios
const AM = [69, 72, 76, 81];
const F = [65, 69, 72, 77];
const C = [72, 76, 79, 84];
const G = [67, 71, 74, 79];
const DM = [62, 65, 69, 74];
const E = [64, 68, 71, 76];
const EM = [64, 67, 71, 76];

// the teaser's tune
const A1 = [69, 72, 76, 72, 74, 72, 69, null];
const A2 = [65, 69, 72, 69, 72, 74, 72, null];
const A3 = [72, 76, 79, 76, 77, 76, 72, 74];
const A4 = [71, 74, 79, 74, 76, 74, 71, null];
const A4UP = [71, 74, 79, 81, 79, 76, 74, null];

const phraseA = (opts: Partial<Bar> = {}, lift = false): Bar[] => [
  { root: 57, lead: A1, arp: AM, ...opts },
  { root: 53, lead: A2, arp: F, ...opts },
  { root: 60, lead: A3, arp: C, ...opts },
  { root: 55, lead: lift ? A4UP : A4, arp: G, ...opts },
];

/**
 * MUNCH's theme: 48 bars at 120 bpm (about 1:36), written to loop without a seam.
 * Intro, the teaser's tune, a brighter B, an LCD arpeggio breakdown, the tune up an octave,
 * a tense bridge, and the tune again leading back into the intro.
 */
function songBars(): Bar[] {
  const intro: Bar[] = [57, 53, 60, 55].map((root) => ({ root, bass: 'walk', hats: 1 }));
  const a: Bar[] = [...phraseA({ bass: 'walk', hats: 1 }), ...phraseA({ bass: 'walk', hats: 1 }, true)];
  const b: Bar[] = (
    [
      [53, [77, null, 76, 77, null, 72, 69, 72]],
      [55, [74, null, 72, 74, null, 71, 67, 71]],
      [52, [76, null, 74, 76, 79, 76, 74, 71]],
      [57, [72, null, 69, 72, 76, null, 72, null]],
      [53, [77, 79, 81, 79, 77, 76, 77, null]],
      [55, [79, null, 77, 76, 74, null, 71, 74]],
      [60, [76, null, 72, 76, 79, null, 84, null]],
      [60, [84, null, 79, null, 76, null, 72, null]],
    ] as [number, (number | null)[]][]
  ).map(([root, lead]) => ({ root, lead, bass: 'walk', hats: 2 }));
  const breakdown: Bar[] = [
    { root: 57, arp: AM, bass: 'hold', hats: 0 },
    { root: 53, arp: F, bass: 'hold', hats: 0 },
    { root: 60, arp: C, bass: 'hold', hats: 0 },
    { root: 55, arp: G, bass: 'hold', hats: 1 },
  ];
  const aUp: Bar[] = [...phraseA({ bass: 'walk', hats: 2, up: 12, leadVol: 0.055 }), ...phraseA({ bass: 'walk', hats: 2, up: 12, leadVol: 0.055 }, true)];
  const bridge: Bar[] = (
    [
      [50, [74, null, 77, null, 81, 79, 77, 74], DM],
      [57, [76, null, 72, null, 69, 72, 76, null], AM],
      [52, [71, 74, 76, 80, 76, 74, 71, 68], E],
      [52, [76, null, null, null, 80, null, 83, null], E],
      [50, [77, 76, 74, null, 77, 79, 81, null], DM],
      [57, [84, null, 81, null, 76, null, 72, null], AM],
      [52, [80, null, 76, null, 71, null, 68, null], EM],
      [55, [67, 71, 74, 77, 79, 77, 74, 71], G],
    ] as [number, (number | null)[], number[]][]
  ).map(([root, lead, arp]) => ({ root, lead, arp, bass: 'drive', hats: 1 }));
  const outro: Bar[] = [...phraseA({ bass: 'walk', hats: 1 }), ...phraseA({ bass: 'walk', hats: 1 })];
  return [...intro, ...a, ...b, ...breakdown, ...aUp, ...bridge, ...outro];
}

export function songNotes(): { sec: number; notes: Note[] } {
  const beat = 0.5;
  const eighth = beat / 2;
  const bars = songBars();
  const notes: Note[] = [];
  bars.forEach((bar, i) => {
    const t0 = i * 4 * beat;
    const lo = bar.root - 12;
    // bass on triangle
    if (bar.bass === 'hold') {
      [0, 2 * beat].forEach((at) => notes.push({ wave: 'tri', f: hz(lo), at: t0 + at, len: 2 * beat - 0.02, vol: 0.24, decay: 1 }));
    } else {
      for (let q = 0; q < 8; q++) notes.push({ wave: 'tri', f: hz(bar.bass === 'drive' ? lo : lo + (q % 2 ? 12 : 0)), at: t0 + q * eighth, len: eighth, vol: 0.22, decay: 1.5 });
    }
    // lead on a thin square
    bar.lead?.forEach((m, q) => {
      if (m) notes.push({ f: hz(m + (bar.up ?? 0)), at: t0 + q * eighth, len: eighth - 0.02, vol: bar.leadVol ?? 0.075, decay: 2, duty: 0.25 });
    });
    // arpeggios in 16ths: alone in the breakdown, quiet under the lead elsewhere
    if (bar.arp && (!bar.lead || bar.up)) {
      const order = [0, 1, 2, 3, 2, 1];
      for (let k = 0; k < 16; k++) notes.push({ f: hz(bar.arp[order[k % order.length]] + (bar.lead ? 12 : 0)), at: t0 + k * (eighth / 2), len: eighth / 2 - 0.01, vol: bar.lead ? 0.028 : 0.06, decay: 3, duty: 0.125 });
    }
    // hats on noise
    if (bar.hats) {
      for (let k = 0; k < 16; k++) {
        const off = k % 4 === 2;
        if (off || (bar.hats === 2 && k % 2 === 1)) notes.push({ wave: 'noise', at: t0 + k * (eighth / 2), len: 0.03, vol: off ? 0.05 : 0.022, decay: 8 });
      }
    }
  });
  // exactly the song's length, so the loop has no gap
  return { sec: bars.length * 4 * beat, notes };
}

export function render(ctx: Pick<BaseAudioContext, 'sampleRate' | 'createBuffer'>, sec: number, notes: Note[], rate?: number): AudioBuffer {
  const sr = rate ?? ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.ceil(sec * sr), sr);
  const out = buf.getChannelData(0);
  let seed = 7;
  const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1;
  for (const { wave = 'square', at = 0, len, f = 440, vol, decay = 4, duty = 0.5 } of notes) {
    const s0 = Math.floor(at * sr);
    const n = Math.floor(len * sr);
    let ph = 0;
    for (let i = 0; i < n && s0 + i < out.length; i++) {
      const t = i / sr;
      ph = (ph + (typeof f === 'function' ? f(t / len) : f) / sr) % 1;
      const v = wave === 'square' ? (ph < duty ? 1 : -1) : wave === 'tri' ? 4 * Math.abs(ph - 0.5) - 1 : noise();
      out[s0 + i] += v * vol * Math.exp((-decay * t) / len) * Math.min(1, i / 40) * Math.min(1, (n - i) / 60);
    }
  }
  return buf;
}

class MunchSfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: AudioBufferSourceNode | null = null;
  private unlocked = false;
  private enabled = true;

  private audio(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.32;
    this.musicGain.connect(this.master);
    document.addEventListener('visibilitychange', () => {
      // a hidden tab goes quiet; it picks up again when it is back
      if (document.hidden) this.ctx?.suspend();
      else if (this.enabled && this.unlocked) this.ctx?.resume();
    });
    return this.ctx;
  }

  private buffer(name: string, make: () => { sec: number; notes: Note[] }, rate?: number) {
    const ctx = this.audio();
    if (!ctx) return null;
    let b = this.buffers.get(name);
    if (!b) {
      const { sec, notes } = make();
      b = render(ctx, sec, notes, rate);
      this.buffers.set(name, b);
    }
    return b;
  }

  play(name: SfxName) {
    // before the first tap the browser would refuse anyway (and warn), so stay quiet
    if (!this.enabled || !this.unlocked) return;
    try {
      const b = this.buffer(name, () => RECIPES[name]);
      const ctx = this.ctx;
      if (!b || !ctx || !this.master) return;
      if (ctx.state === 'suspended') ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.connect(this.master);
      src.start();
    } catch {
      // no audio on this device
    }
  }

  /** The first tap or key: audio is allowed from here on, and the music starts. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const ctx = this.audio();
    if (!ctx) return;
    if (this.enabled) {
      ctx.resume();
      this.startMusic();
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.stopMusic();
      return;
    }
    if (this.unlocked) {
      this.ctx?.resume();
      this.startMusic();
    }
  }

  private startMusic() {
    if (this.music) return;
    try {
      const b = this.buffer('song', songNotes, 22050);
      if (!b || !this.ctx || !this.musicGain) return;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.music = src;
    } catch {
      // no audio on this device
    }
  }

  private stopMusic() {
    try {
      this.music?.stop();
    } catch {
      // already stopped
    }
    this.music = null;
  }
}

export const sfx = new MunchSfx();
