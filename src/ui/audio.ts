// 10.4 BGM と SE。外部の音源は使わず、Web Audio で鳴らすオリジナルのピコピコ音。
// 聞こえる範囲は届いた出来事だけで決まる（サーバーが見え方で絞った後の出来事しか来ない）。

export type SongId = 'title' | 'draft' | 'day' | 'night' | 'storm' | 'final' | 'ghost' | 'result';
export type SeId =
  | 'click'
  | 'gather'
  | 'gatherRare'
  | 'gatherNone'
  | 'hit'
  | 'miss'
  | 'hurt'
  | 'trap'
  | 'whisper'
  | 'warn'
  | 'progress'
  | 'trait'
  | 'nearVictory'
  | 'bell'
  | 'smoke'
  | 'horn'
  | 'lord'
  | 'fort'
  | 'weather'
  | 'tide'
  | 'revive'
  | 'step'
  | 'animal'
  | 'monkey'
  | 'haunt'
  | 'craft'
  | 'eat'
  | 'victory';

interface Track {
  wave: OscillatorType | 'noise';
  /** 8分音符ごとの音。'.' は休み、'-' は前の音を伸ばす */
  notes: string;
  volume: number;
  /** 音を切る長さ（1拍に対する割合） */
  gate?: number;
}

interface Song {
  tempo: number;
  tracks: Track[];
  /** 低い音だけにして水の中のように聞かせる */
  muffled?: boolean;
  /** 一度だけ鳴らして、次の曲へ */
  then?: SongId;
}

const DRUM: Record<string, { freq: number; length: number; noise: boolean }> = {
  K: { freq: 70, length: 0.12, noise: false },
  S: { freq: 1800, length: 0.1, noise: true },
  H: { freq: 7000, length: 0.03, noise: true },
  T: { freq: 140, length: 0.15, noise: false },
  W: { freq: 500, length: 0.9, noise: true },
};

// 曲はすべてこのゲームのために書いたもの
const SONGS: Record<SongId, Song> = {
  title: {
    tempo: 84,
    tracks: [
      { wave: 'triangle', volume: 0.22, notes: 'E5 - G5 - A5 - G5 E5 D5 - - - C5 - D5 - E5 - G5 - C6 - A5 G5 A5 - - - - - . .' },
      { wave: 'triangle', volume: 0.2, notes: 'C3 - - - G2 - - - A2 - - - E2 - - - F2 - - - C3 - - - G2 - - - - - - -' },
      { wave: 'noise', volume: 0.05, notes: 'W . . . . . . . W . . . . . . . W . . . . . . . W . . . . . . .' },
    ],
  },
  draft: {
    tempo: 132,
    tracks: [
      { wave: 'square', volume: 0.08, gate: 0.6, notes: 'C5 E5 G5 C6 B4 D5 G5 B5 A4 C5 E5 A5 G4 B4 D5 G5 F4 A4 C5 F5 E4 G4 C5 E5 D4 F4 A4 D5 G4 B4 D5 G5' },
      { wave: 'triangle', volume: 0.22, notes: 'C3 - C3 - G2 - G2 - A2 - A2 - E2 - E2 - F2 - F2 - C3 - C3 - D3 - D3 - G2 - G2 -' },
      { wave: 'noise', volume: 0.07, notes: 'K H S H K H S H K H S H K H S H K H S H K H S H K H S H K K S S' },
    ],
  },
  day: {
    tempo: 116,
    tracks: [
      { wave: 'square', volume: 0.07, gate: 0.8, notes: 'F5 - A5 - C6 - A5 - G5 - A#5 - A5 - F5 - E5 - G5 - C6 - G5 - A5 - - - . . . . D5 - F5 - A5 - F5 - C5 - E5 - G5 - E5 - F5 - G5 - A5 - C6 - F5 - - - - - . .' },
      { wave: 'triangle', volume: 0.22, notes: 'F2 . C3 . F2 . C3 . A#2 . F3 . A#2 . F3 . C3 . G3 . C3 . G3 . F2 . C3 . F2 . . . D3 . A2 . D3 . A2 . C3 . G2 . C3 . G2 . A#2 . F3 . C3 . G3 . F2 . C3 . F2 . . .' },
      { wave: 'noise', volume: 0.05, notes: 'K . H . S . H . K . H . S . H H K . H . S . H . K . H . S . H . K . H . S . H . K . H . S . H H K . H . S . H . K . H . S . . .' },
    ],
  },
  night: {
    tempo: 76,
    tracks: [
      { wave: 'triangle', volume: 0.2, notes: 'E5 - - - . . . . C5 - - - B4 - - - A4 - - - . . C5 - B4 - - - . . . .' },
      { wave: 'triangle', volume: 0.24, notes: 'A2 - - - A2 - - - F2 - - - E2 - - - A2 - - - A2 - - - D2 - - - E2 - - -' },
      { wave: 'noise', volume: 0.02, notes: 'H . H H . . H . H . H H . . H . H . H H . . H . H . H H . . H .' },
    ],
  },
  storm: {
    tempo: 70,
    tracks: [
      { wave: 'noise', volume: 0.12, notes: 'W . . . W . . . W . . . W . . .' },
      { wave: 'sawtooth', volume: 0.05, notes: 'D2 - - - - - - - C#2 - - - - - - -' },
      { wave: 'triangle', volume: 0.12, notes: 'A4 - - - G#4 - - - . . . . . . . .' },
    ],
  },
  final: {
    tempo: 152,
    tracks: [
      { wave: 'square', volume: 0.08, gate: 0.7, notes: 'D5 F5 A5 F5 E5 G5 A#5 G5 F5 A5 D6 A5 C#5 E5 A5 E5 D5 F5 A5 D6 C6 A#5 A5 G5 F5 E5 D5 C#5 D5 - - -' },
      { wave: 'sawtooth', volume: 0.07, notes: 'D2 D2 D3 D2 D2 D2 D3 D2 A#1 A#1 A#2 A#1 A1 A1 A2 A1 D2 D2 D3 D2 G1 G1 G2 G1 A1 A1 A2 A1 D2 D2 D2 D2' },
      { wave: 'noise', volume: 0.08, notes: 'K H S H K K S H K H S H K K S S K H S H K K S H K H S H K S K S' },
    ],
  },
  ghost: {
    tempo: 66,
    muffled: true,
    tracks: [
      { wave: 'sine', volume: 0.25, notes: 'A4 - - - C5 - - - E5 - - - D5 - - - C5 - - - B4 - - - A4 - - - - - - -' },
      { wave: 'sine', volume: 0.25, notes: 'A2 - - - - - - - F2 - - - - - - - D2 - - - - - - - E2 - - - - - - -' },
    ],
  },
  result: {
    tempo: 120,
    then: 'title',
    tracks: [
      { wave: 'square', volume: 0.1, gate: 0.9, notes: 'C5 E5 G5 C6 - - G5 C6 - - - - . . . .' },
      { wave: 'triangle', volume: 0.24, notes: 'C3 - - - - - G2 - C3 - - - . . . .' },
      { wave: 'noise', volume: 0.08, notes: 'K . . . S . . . K S K S K . . .' },
    ],
  },
};

const NOTE_INDEX: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
const noteFreq = (name: string) => {
  const match = /^([A-G]#?)(\d)$/.exec(name);
  if (!match) return null;
  const midi = 12 * (Number(match[2]) + 1) + NOTE_INDEX[match[1]];
  return 440 * 2 ** ((midi - 69) / 12);
};

const SETTINGS_KEY = 'island-survival-sound';
const LOOKAHEAD = 0.25;
const TICK_MS = 60;

interface Settings {
  bgm: number;
  se: number;
  muted: boolean;
}

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (saved) return { bgm: saved.bgm ?? 0.6, se: saved.se ?? 0.8, muted: !!saved.muted };
  } catch {
    // 保存できない環境でも鳴らせる
  }
  return { bgm: 0.6, se: 0.8, muted: false };
}

class Sound {
  private ctx: AudioContext | null = null;
  private bgmBus: GainNode | null = null;
  private seBus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private song: SongId | null = null;
  private wanted: SongId | null = null;
  private step = 0;
  private nextTime = 0;
  private timer = 0;
  private tempoBoost = 0;
  /** 本人にだけ重ねる心臓の音と、「勝利目前」の後の太鼓 */
  heartbeat = false;
  drums = false;
  readonly settings = loadSettings();

  /** スマホは画面を触るまで音を出せないので、最初の操作で始める */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.bgmBus = ctx.createGain();
    this.seBus = ctx.createGain();
    this.bgmBus.connect(this.filter).connect(ctx.destination);
    this.seBus.connect(ctx.destination);
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    this.applyVolume();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    if (this.wanted) this.play(this.wanted);
  }

  setVolume(kind: 'bgm' | 'se', value: number) {
    this.settings[kind] = value;
    this.save();
    this.applyVolume();
  }

  setMuted(muted: boolean) {
    this.settings.muted = muted;
    this.save();
    this.applyVolume();
  }

  private save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // 覚えられないだけ
    }
  }

  private applyVolume() {
    if (!this.ctx || !this.bgmBus || !this.seBus) return;
    const on = this.settings.muted ? 0 : 1;
    this.bgmBus.gain.setTargetAtTime(this.settings.bgm * on, this.ctx.currentTime, 0.05);
    this.seBus.gain.setTargetAtTime(this.settings.se * on, this.ctx.currentTime, 0.02);
  }

  /** 流す曲を決める。同じ曲なら続ける */
  play(id: SongId, tempoBoost = 0) {
    this.wanted = id;
    this.tempoBoost = tempoBoost;
    if (!this.ctx || this.song === id) return;
    this.song = id;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.filter!.frequency.setTargetAtTime(SONGS[id].muffled ? 600 : 20000, this.ctx.currentTime, 0.3);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.song) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      const song = SONGS[this.song];
      const beat = 60 / (song.tempo + this.tempoBoost) / 2;
      const length = Math.max(...song.tracks.map((t) => t.notes.split(' ').length));
      for (const track of song.tracks) {
        const tokens = track.notes.split(' ');
        const token = tokens[this.step % tokens.length];
        if (token === '.' || token === '-') continue;
        let hold = 1;
        while (tokens[(this.step + hold) % tokens.length] === '-' && hold < tokens.length) hold += 1;
        this.voice(track, token, this.nextTime, beat * hold * (track.gate ?? 0.95));
      }
      // 本人だけに重ねる音
      if (this.heartbeat && this.step % 4 === 0) {
        this.tone('sine', 55, this.nextTime, 0.12, 0.5, this.bgmBus!);
        this.tone('sine', 50, this.nextTime + 0.18, 0.1, 0.35, this.bgmBus!);
      }
      if (this.drums && this.step % 2 === 0) this.tone('triangle', this.step % 4 === 0 ? 110 : 82, this.nextTime, 0.14, 0.22, this.bgmBus!);
      this.nextTime += beat;
      this.step += 1;
      if (song.then && this.step >= length) {
        this.song = null;
        this.play(song.then);
        return;
      }
    }
  }

  private voice(track: Track, token: string, at: number, length: number) {
    if (track.wave === 'noise') {
      const drum = DRUM[token];
      if (!drum) return;
      if (drum.noise) this.hiss(drum.freq, at, drum.length, track.volume * (token === 'W' ? 1 : 1.5), this.bgmBus!);
      else this.tone('sine', drum.freq, at, drum.length, track.volume * 4, this.bgmBus!, drum.freq / 2);
      return;
    }
    const freq = noteFreq(token);
    if (freq) this.tone(track.wave, freq, at, length, track.volume, this.bgmBus!);
  }

  private tone(wave: OscillatorType, freq: number, at: number, length: number, volume: number, bus: AudioNode, slideTo?: number, pan = 0) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    let out: AudioNode = gain;
    if (pan !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      out = panner;
    }
    osc.connect(gain);
    out.connect(bus);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  private hiss(freq: number, at: number, length: number, volume: number, bus: AudioNode, pan = 0) {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = freq > 1000 ? 'highpass' : 'bandpass';
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + Math.min(0.3, length / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain);
    if (pan !== 0 && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner).connect(bus);
    } else gain.connect(bus);
    source.start(at, Math.random() * 0.5);
    source.stop(at + length + 0.05);
  }

  /** 効果音。pan は −1（左）〜 1（右）で、相手のいる方向を伝える */
  se(id: SeId, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.seBus) return;
    const t = ctx.currentTime + 0.01;
    const bus = this.seBus;
    const up = (wave: OscillatorType, notes: number[], gap: number, length: number, volume: number) =>
      notes.forEach((freq, i) => this.tone(wave, freq, t + i * gap, length, volume, bus, undefined, pan));
    switch (id) {
      case 'click':
        return up('square', [880], 0, 0.04, 0.06);
      case 'gather':
        return up('square', [660, 990], 0.06, 0.08, 0.08);
      case 'gatherRare':
        return up('square', [784, 988, 1175, 1568], 0.07, 0.12, 0.09);
      case 'gatherNone':
        return up('triangle', [330, 247], 0.08, 0.1, 0.15);
      case 'hit':
        this.hiss(1200, t, 0.12, 0.35, bus, pan);
        return this.tone('square', 220, t, 0.12, 0.12, bus, 80, pan);
      case 'miss':
        return this.hiss(3000, t, 0.15, 0.15, bus, pan);
      case 'hurt':
        this.hiss(800, t, 0.2, 0.3, bus);
        return this.tone('sawtooth', 300, t, 0.25, 0.12, bus, 90);
      case 'trap':
        this.tone('square', 1400, t, 0.05, 0.1, bus);
        return this.hiss(900, t + 0.04, 0.2, 0.35, bus);
      case 'whisper':
        return up('sine', [1046, 1318], 0.09, 0.12, 0.12);
      case 'warn':
        return up('square', [440, 440], 0.16, 0.08, 0.07);
      case 'progress':
        return up('triangle', [523, 659, 784], 0.07, 0.12, 0.2);
      case 'trait':
        return up('square', [523, 659, 784, 1046, 1318], 0.06, 0.14, 0.08);
      case 'nearVictory':
        return up('sawtooth', [392, 392, 392, 523], 0.14, 0.12, 0.08);
      case 'bell':
        up('sine', [392, 392 * 2.4], 0, 1.6, 0.18);
        return up('sine', [330], 0.8, 1.6, 0.14);
      case 'smoke':
        return this.hiss(400, t, 1.2, 0.2, bus);
      case 'horn':
        this.tone('sawtooth', 147, t, 1.2, 0.12, bus);
        return this.tone('sawtooth', 220, t, 1.2, 0.08, bus);
      case 'lord':
        return up('square', [392, 523, 659, 784, 1046], 0.08, 0.16, 0.09);
      case 'fort':
        this.tone('triangle', 110, t, 0.2, 0.3, bus);
        return up('square', [523, 784], 0.15, 0.2, 0.08);
      case 'weather':
        return up('triangle', [587, 880], 0.1, 0.18, 0.15);
      case 'tide':
        return this.hiss(600, t, 1, 0.25, bus);
      case 'revive':
        return up('triangle', [262, 392, 523, 784], 0.1, 0.2, 0.2);
      case 'step':
        return this.hiss(2500, t, 0.05, 0.05, bus, pan);
      case 'animal':
        return this.tone('square', 700, t, 0.12, 0.06, bus, 1100, pan);
      case 'monkey':
        return up('square', [1200, 900, 1200], 0.05, 0.05, 0.06);
      case 'haunt':
        return this.tone('sine', 300, t, 0.8, 0.15, bus, 600);
      case 'craft':
        return up('square', [330, 330, 494], 0.07, 0.05, 0.08);
      case 'eat':
        return up('triangle', [523, 659], 0.06, 0.08, 0.18);
      case 'victory':
        return up('square', [523, 659, 784, 1046], 0.12, 0.3, 0.1);
    }
  }

  dispose() {
    window.clearInterval(this.timer);
  }
}

export const sound = new Sound();
