/**
 * MUNCH's sounds, synthesised like a cheap handheld: square, triangle and noise, the same
 * recipes as the X kit (konten-x/studio/scripts/munch-sfx.mjs). Nothing is sampled or
 * downloaded; each sound is rendered once into a buffer the first time it plays.
 * Browsers only allow audio after a tap or key, so the music starts on the first one.
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

/** The 8-bar loop from the teaser: 120 bpm, Am F C G, lead on square, bass on triangle, noise hats. */
function loopNotes(): { sec: number; notes: Note[] } {
  const beat = 0.5;
  const bars = 8;
  const prog = [57, 53, 60, 55];
  const lead = [
    [69, 72, 76, 72, 74, 72, 69, null],
    [65, 69, 72, 69, 72, 74, 72, null],
    [72, 76, 79, 76, 77, 76, 72, 74],
    [71, 74, 79, 74, 76, 74, 71, null],
  ];
  const notes: Note[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let q = 0; q < 8; q++) {
      const at = bar * 4 * beat + q * (beat / 2);
      notes.push({ wave: 'tri', f: hz(prog[bar % 4] - 12 + (q % 2 ? 12 : 0)), at, len: beat / 2, vol: 0.22, decay: 1.5 });
      const m = bar >= 2 ? lead[bar % 4][q] : null;
      if (m) notes.push({ f: hz(m), at, len: beat / 2 - 0.02, vol: 0.075, decay: 2, duty: 0.25 });
      if (q % 2) notes.push({ wave: 'noise', at, len: 0.03, vol: 0.05, decay: 8 });
    }
  }
  // exactly 8 bars long, so it loops without a gap
  return { sec: bars * 4 * beat, notes };
}

function render(ctx: BaseAudioContext, sec: number, notes: Note[]): AudioBuffer {
  const sr = ctx.sampleRate;
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

  private buffer(name: string, make: () => { sec: number; notes: Note[] }) {
    const ctx = this.audio();
    if (!ctx) return null;
    let b = this.buffers.get(name);
    if (!b) {
      const { sec, notes } = make();
      b = render(ctx, sec, notes);
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
      const b = this.buffer('loop', loopNotes);
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
