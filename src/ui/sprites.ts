// ドット絵。すべてこのファイルの中で描く（外部の画像は使わない）。
// 文字の格子をパレットで色に置き換え、canvas で作った data URL を <img> に渡す。
import type { ItemId, JobId, NpcKind, StructureKind, TerrainId, Weather } from '../core/index';

type Palette = Record<string, string>;
type Grid = readonly string[];

const INK = '#2b1d2e';

/** 全体で使う色。絵ごとのパレットで上書きできる */
const BASE: Palette = {
  k: INK,
  w: '#fff8e8',
  x: '#1a1422',
  r: '#e0483e',
  y: '#ffd24a',
  o: '#f08a2c',
  n: '#a8703c',
  d: '#7a4a28',
  s: '#ffd3a8',
  e: '#3a2438',
};

const SEAT_COLORS = [
  ['#e0483e', '#a82c2c'],
  ['#3a7fe0', '#2756a8'],
  ['#a052d8', '#7234a4'],
  ['#f08a2c', '#b85e14'],
  ['#1fb39c', '#127a6c'],
];

const cache = new Map<string, string>();
const canvases = new Map<string, HTMLCanvasElement>();

class Painter {
  readonly ctx: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }
  rect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }
  art(rows: Grid, palette: Palette = {}, ox = 0, oy = 0) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        this.rect(ox + x, oy + y, 1, 1, palette[ch] ?? BASE[ch] ?? '#ff00ff');
      }
    });
  }
  /** 決まった並びの点を散らす（同じ絵がいつも同じになるように乱数は使わない） */
  speckle(seed: number, count: number, color: string, width = this.canvas.width, height = this.canvas.height) {
    let v = seed * 2654435761 + 12345;
    for (let i = 0; i < count; i++) {
      v = (Math.imul(v, 1103515245) + 12345) | 0;
      const x = (v >>> 8) % width;
      v = (Math.imul(v, 1103515245) + 12345) | 0;
      const y = (v >>> 8) % height;
      this.rect(x, y, 1, 1, color);
    }
  }
  blit(other: HTMLCanvasElement, x: number, y: number) {
    this.ctx.drawImage(other, x, y);
  }
}

function sprite(key: string, width: number, height: number, draw: (p: Painter) => void): HTMLCanvasElement {
  const known = canvases.get(key);
  if (known) return known;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(new Painter(canvas));
  canvases.set(key, canvas);
  return canvas;
}

function url(key: string, width: number, height: number, draw: (p: Painter) => void): string {
  const known = cache.get(key);
  if (known) return known;
  const made = sprite(key, width, height, draw).toDataURL('image/png');
  cache.set(key, made);
  return made;
}

// ―― 地形 ――

const TREE: Grid = [
  '..kkkk..',
  '.klllgk.',
  'klllgggk',
  'kllggggk',
  'kgggggtk',
  'kggggttk',
  '.ktttgk.',
  '..knnk..',
  '..knnk..',
  '...kk...',
];
const TREE_COLORS: Palette = { l: '#7ed957', g: '#3faa4a', t: '#23803f' };

const MOUNTAIN: Grid = [
  '................',
  '.......kk.......',
  '......kwwk......',
  '.....kwwwwk.....',
  '....kwwbwwbk....',
  '....kbbbbbbk....',
  '...kbbbbttbbk...',
  '...kbbbttbbbbk..',
  '..kbbbbbbbttbbk.',
  '..kbttbbbbbbbbk.',
  '.kbbbbbbttbbbbbk',
  '.kbbbbtbbbbbttbk',
  'kbbttbbbbbbbbbbk',
  'kbbbbbbbttbbbbbk',
  'kkkkkkkkkkkkkkkk',
];
const ROCKS: Grid = [
  '................',
  '...kkkk.........',
  '..klllgk...kkk..',
  '.klllgggk.kllgk.',
  '.kllggggk.klggk.',
  '.kgggggtk.kgttk.',
  '..kkkkkk...kkk..',
  '................',
  '.....kkkkk......',
  '....kllllgk.....',
  '...kllgggggk....',
  '...klggggttk....',
  '...kggggtttk....',
  '....kkkkkkk.....',
];
const CAVE: Grid = [
  '................',
  '....kkkkkkkk....',
  '...klllggggtk...',
  '..klgggggggttk..',
  '..klgkkkkkkgtk..',
  '.klgkxxxxxxkgtk.',
  '.kggkxxxxxxkgtk.',
  '.kggkxxxxxxkttk.',
  '.kgkxxxxxxxxktk.',
  '.kgkxxxxxxxxktk.',
  '.kkkxxxxxxxxkkk.',
  '................',
];
const WRECK: Grid = [
  '................',
  '.......kk.......',
  '.......nk.kkk...',
  '.......nkkwwwk..',
  '.......nk.kwwk..',
  '.......nk..kwk..',
  '.......nk...k...',
  '..k....nk.......',
  '..kk...nk....kk.',
  '..knkkkkkkkkknk.',
  '..knnnddnnnddnk.',
  '...knnnnkknnnk..',
  '...kddnnkxkddk..',
  '....kkkkkkkkk...',
];
const RUINS: Grid = [
  '................',
  '..kkkkk...kkkkk.',
  '..kllgk...kllgk.',
  '..kkkkk...kkkkk.',
  '...klk.....klk..',
  '...klk.....kgk..',
  '...kgk.....kk...',
  '...klk..........',
  '...klk....kk....',
  '...kgk...kllk...',
  '...klk..klggk...',
  '..kkkkk.kkkkkk..',
  '..kllgk.........',
  '..kkkkk.........',
];
const POND: Grid = [
  '................',
  '................',
  '.....kkkkkk.....',
  '...kkaaaaaakk...',
  '..kaaawaaaaaak..',
  '.kaaaaaaaaawaak.',
  '.kaawaaaaaaaaak.',
  '.kaaaaaaawaaaak.',
  '.kaaaaaaaaaaaak.',
  '..kaaaawaaaaak..',
  '...kkaaaaaakk...',
  '.....kkkkkk.....',
];

const GRASS = ['#7ccf5a', '#5db548', '#a2e36e'];

function grassBase(p: Painter, seed: number) {
  p.rect(0, 0, 16, 16, GRASS[0]);
  p.speckle(seed + 3, 16, GRASS[1]);
  p.speckle(seed + 7, 8, GRASS[2]);
}

function sandBase(p: Painter, seed: number) {
  p.rect(0, 0, 16, 16, '#f6dc8e');
  p.speckle(seed + 3, 14, '#e4c26c');
  p.speckle(seed + 9, 8, '#fff0b8');
}

function drawTerrain(p: Painter, terrain: TerrainId, v: number) {
  switch (terrain) {
    case 'sea':
      p.rect(0, 0, 16, 16, '#3a9fe0');
      p.speckle(v + 21, 12, '#2f8bd0');
      p.rect(2 + v * 3, 4, 4, 1, '#6cc4f0');
      p.rect(9 - v, 11, 5, 1, '#6cc4f0');
      break;
    case 'beach':
      sandBase(p, v);
      if (v === 1) p.art(['.kk.', 'kwyk', '.kk.'], {}, 10, 10);
      if (v === 2) p.art(['.r.r.', 'rrrrr', '.r.r.'], {}, 3, 5);
      break;
    case 'grass':
      grassBase(p, v);
      for (const [x, y] of [[3, 4], [11, 3], [6, 11], [12, 12]]) {
        p.rect(x, y, 1, 2, GRASS[1]);
        p.rect(x + 2, y, 1, 2, GRASS[1]);
        p.rect(x + 1, y + 1, 1, 2, GRASS[1]);
      }
      if (v === 1) p.art(['.y.', 'yoy', '.y.'], {}, 8, 7);
      if (v === 2) p.art(['.w.', 'wyw', '.w.'], {}, 3, 10);
      break;
    case 'forest':
      p.rect(0, 0, 16, 16, '#4aa548');
      p.speckle(v + 2, 16, '#3a8c3e');
      if (v === 0) {
        p.art(TREE, TREE_COLORS, 0, 0);
        p.art(TREE, TREE_COLORS, 8, 2);
        p.art(TREE, TREE_COLORS, 3, 6);
      } else if (v === 1) {
        p.art(TREE, TREE_COLORS, 7, 0);
        p.art(TREE, TREE_COLORS, 0, 3);
        p.art(TREE, TREE_COLORS, 8, 6);
      } else {
        p.art(TREE, TREE_COLORS, 4, 0);
        p.art(TREE, TREE_COLORS, 0, 6);
        p.art(TREE, TREE_COLORS, 8, 6);
      }
      break;
    case 'rock':
      p.rect(0, 0, 16, 16, '#c2b69c');
      p.speckle(v + 1, 18, '#a89a80');
      p.art(ROCKS, { l: '#e6e0d2', g: '#a8a498', t: '#7c7a74' }, v === 1 ? 1 : 0, v === 2 ? 1 : 0);
      break;
    case 'mountain':
      grassBase(p, v);
      p.art(MOUNTAIN, { b: '#94765c', t: '#74584a' }, 0, 1);
      break;
    case 'spring':
      grassBase(p, v);
      p.art(POND, { a: '#5cd4ec' });
      break;
    case 'river':
      p.rect(0, 0, 16, 16, '#49b7e8');
      p.speckle(v + 5, 10, '#3aa2d8');
      for (const [x, y] of [[2, 3], [10, 6], [5, 10], [12, 13]]) p.rect(x, y, 3, 1, '#a4e4f8');
      break;
    case 'cave':
      p.rect(0, 0, 16, 16, '#c2b69c');
      p.speckle(v + 4, 16, '#a89a80');
      p.art(CAVE, { l: '#d6cdbc', g: '#8e8a84', t: '#6a6660' }, 0, 2);
      break;
    case 'wreck':
      sandBase(p, v);
      p.art(WRECK, {}, 0, 1);
      break;
    case 'ruins':
      grassBase(p, v);
      p.art(RUINS, { l: '#e4daf2', g: '#a892c8' }, 0, 1);
      break;
  }
}

export const terrainUrl = (terrain: TerrainId, x: number, y: number) => {
  const v = (x * 7 + y * 13) % 3;
  return url(`t:${terrain}:${v}`, 16, 16, (p) => drawTerrain(p, terrain, v));
};

/** 未探索のマス。ふわふわの雲で覆う */
export const fogUrl = (x: number, y: number) => {
  const v = (x * 5 + y * 3) % 3;
  return url(`fog:${v}`, 16, 16, (p) => {
    p.rect(0, 0, 16, 16, '#6f7fa8');
    p.speckle(v + 11, 12, '#61709a');
    const puffs = [
      [[1, 2, 7, 4], [3, 1, 3, 1], [9, 9, 6, 3], [10, 8, 3, 1]],
      [[7, 3, 8, 3], [9, 2, 4, 1], [1, 10, 6, 3], [2, 9, 3, 1]],
      [[4, 6, 8, 4], [6, 5, 4, 1], [0, 13, 4, 2], [12, 0, 4, 2]],
    ][v];
    for (const [px, py, w, h] of puffs) p.rect(px, py, w, h, '#8c9cc4');
  });
};

/** 海のきらめき。2コマで交互に見せる */
export const waveUrl = (x: number, y: number) => {
  const v = (x + y * 2) % 3;
  return url(`wave:${v}`, 16, 16, (p) => {
    p.rect(8 - v * 2, 3 + v * 3, 5, 1, '#a4e0fa');
    p.rect(1 + v * 4, 12 - v, 4, 1, '#a4e0fa');
  });
};

/** 海と接する辺の波打ちぎわ */
export const shoreUrl = (side: 'up' | 'down' | 'left' | 'right') =>
  url(`shore:${side}`, 16, 16, (p) => {
    for (let i = 0; i < 16; i++) {
      const edge = i % 4 === 0 ? 2 : 1;
      if (side === 'up') p.rect(i, 0, 1, edge, '#fff8e8');
      if (side === 'down') p.rect(i, 16 - edge, 1, edge, '#fff8e8');
      if (side === 'left') p.rect(0, i, edge, 1, '#fff8e8');
      if (side === 'right') p.rect(16 - edge, i, edge, 1, '#fff8e8');
    }
  });

// ―― 人 ――

const BODY: Grid = [
  '................',
  '....kkkkkkkk....',
  '...khhhhhhhhk...',
  '...khhhhhhhhk...',
  '...khhsshhssk...',
  '...kssssssssk...',
  '...ksessssesk...',
  '...ksessssesk...',
  '....kksssskk....',
  '...kcccccccck...',
  '..kskccccccksk..',
  '..kskddddddksk..',
  '...kkddddddkk...',
  '....kppkkppk....',
  '....kbbkkbbk....',
  '.....kk..kk.....',
];

const HATS: Record<JobId, { rows: Grid; palette: Palette; hair: string }> = {
  // 麦わら帽子
  fisher: {
    hair: '#5c3a24',
    palette: { a: '#ffe08a', b: '#e0483e' },
    rows: ['................', '.....kkkkkk.....', '....kaaaaaak....', '...kbbbbbbbbk...', '.kkaaaaaaaaaakk.', 'kaaaaaaaaaaaaaak', '.kkkkkkkkkkkkkk.'],
  },
  // ヘルメットと鉢巻き
  carpenter: {
    hair: '#3a2a1c',
    palette: { a: '#ffc62e', b: '#d89a14' },
    rows: ['................', '.....kkkkkk.....', '....kaaaaaak....', '...kaaaabaaak...', '..kkaaaaaaaakk..', '..kbbbbbbbbbbk..'],
  },
  // 赤十字の帽子
  doctor: {
    hair: '#2c3a5c',
    palette: { a: '#ffffff', b: '#e0483e', c: '#d8dce4' },
    rows: ['................', '....kkkkkkkk....', '...kaaabbaaak...', '...kaabbbbaak...', '...kaaabbaaak...', '...kcccccccck...'],
  },
  // 鉄かぶと
  soldier: {
    hair: '#3a2a1c',
    palette: { a: '#6a8a4a', b: '#4c6a34', c: '#94b070' },
    rows: ['................', '.....kkkkkk.....', '....kcaaaaak....', '...kcaaaaaaak...', '...kaaaaaaabk...', '..kbbbbbbbbbbk..', '...kkkkkkkkkk...'],
  },
  // 探検帽
  explorer: {
    hair: '#8a4a24',
    palette: { a: '#d8bc84', b: '#a88c58', c: '#7a4a28' },
    rows: ['................', '.....kkkkkk.....', '....kaaaaaak....', '...kaaaaaaaak...', '...kcccccccck...', '.kkaaaaaaaaaakk.', '.kbbbbbbbbbbbbk.', '..kkkkkkkkkkkk..'],
  },
  // コック帽
  cook: {
    hair: '#5c3a24',
    palette: { a: '#ffffff', b: '#d8dce4' },
    rows: ['...kkk.kkkk.....', '..kaaakaaaakk...', '..kaaaaaaaaaak..', '..kaaaaaaaaabk..', '...kaaaaaaabk...', '...kbbbbbbbbk...'],
  },
};

const bodyPalette = (seat: number, hair: string): Palette => ({
  h: hair,
  c: SEAT_COLORS[seat % SEAT_COLORS.length][0],
  d: SEAT_COLORS[seat % SEAT_COLORS.length][1],
  p: '#4a4a6a',
  b: '#6a4228',
});

const personCanvas = (job: JobId | null, seat: number) =>
  sprite(`p:${job}:${seat}`, 16, 16, (p) => {
    const hat = job ? HATS[job] : null;
    p.art(BODY, bodyPalette(seat, hat?.hair ?? '#5c3a24'));
    if (hat) p.art(hat.rows, hat.palette);
  });

export const personUrl = (job: JobId | null, seat: number) =>
  url(`pu:${job}:${seat}`, 16, 16, (p) => p.blit(personCanvas(job, seat), 0, 0));

const SILHOUETTE: Grid = BODY.map((row) => row.replace(/[^.]/g, 'k'));

export const shadowUrl = () =>
  url('shadow', 16, 16, (p) => {
    p.art(SILHOUETTE, { k: '#141226' });
    p.art(['.ww.', 'w..w', '...w', '..w.', '....', '..w.'], {}, 6, 2);
  });

const GHOST: Grid = [
  '................',
  '.....kkkkkk.....',
  '....kwwwwwwk....',
  '...kwwwwwwwwk...',
  '...kwewwwewwk...',
  '...kwewwwewwk...',
  '...kwwwwwwwwk...',
  '..kwwwwqqwwwwk..',
  '.kwkwwwwwwwwkwk.',
  '.kk.kwwwwwwk.kk.',
  '....kwwwwwwk....',
  '....kwwwwwwk....',
  '....kwkwwkwk....',
  '....kk.kk.kk....',
];

export const ghostUrl = () => url('ghost', 16, 16, (p) => p.art(GHOST, { q: '#e090a0' }, 0, 1));

// ―― 動物 ――

const NPC_ART: Record<NpcKind, { rows: Grid; palette: Palette }> = {
  critter: {
    palette: { a: '#e8d4b0', b: '#c0a47c', q: '#f0a0a8' },
    rows: [
      '................',
      '................',
      '....kk...kk.....',
      '....kak..kak....',
      '....kqk..kqk....',
      '....kak..kak....',
      '...kaaakkaaak...',
      '...kaaaaaaaak...',
      '...kaeaaaaeak...',
      '...kaaaqqaaak...',
      '....kaaaaaak....',
      '...kbaaaaaabk...',
      '...kbaaaaaabk...',
      '....kkkkkkkk....',
    ],
  },
  monkey: {
    palette: { a: '#a0683c', b: '#f0c898', c: '#7a4a28' },
    rows: [
      '................',
      '.....kkkkkk.....',
      '....kaaaaaak....',
      '..kkaaaaaaaakk..',
      '.kbkabbaabbakbk.',
      '.kbkabebbebakbk.',
      '..kkabbbbbbakk..',
      '....kabbbbak....',
      '...kkakkkkakk...',
      '..kaakaaaakaak..',
      '..kak.kaak.kak..',
      '...k.kaaaak.k.kk',
      '.....kakkak..kak',
      '.....kk..kk..kk.',
    ],
  },
  boar: {
    palette: { a: '#6a4a38', b: '#4a3028', c: '#fff8e8', q: '#c08878' },
    rows: [
      '................',
      '................',
      '..k.k.kk.k.k....',
      '..kkkkkkkkkkkk..',
      '.kbbbbbbbbaaaak.',
      '.kbaaaaaaaaaaeak',
      'kbaaaaaaaaaaaaak',
      'kbaaaaaaaaaaaqqk',
      'kaaaaaaaaaaacqqk',
      'kaaaaaaaaaaackkk',
      '.kaaaaaaaaaaak..',
      '..kaakkkkkaak...',
      '..kbbk...kbbk...',
      '...kk.....kk....',
    ],
  },
  herd: {
    palette: { a: '#c8905c', b: '#a06c3c', c: '#fff0d8' },
    rows: [
      '................',
      '.k.k............',
      '.kkk.....k.k....',
      '.kak.....kkk....',
      'kaeak....kak....',
      '.kaakkkkkaeak...',
      '..kaaaaaaakak...',
      '..kacaacaak.....',
      '..kaaaaaaak.....',
      '..kbkkkkkbk.....',
      '..kk.k.kkkaaaak.',
      '.....kaaaacaacak',
      '.....kbaaaaaaabk',
      '.....kbk...kbk..',
      '.....kk.....kk..',
    ],
  },
  castaway: {
    palette: { a: '#d8c8a0', h: '#5c3a24', p: '#6a7a9a' },
    rows: [
      '................',
      '................',
      '................',
      '....kk..........',
      '...k.wk..k......',
      '....kwk..rk.....',
      '.....k...k......',
      '................',
      '.kkkkk..........',
      'khhhhskkkkkkkkk.',
      'khhsesaaaaaaappk',
      'khhsssaaaaaaappk',
      '.kkkkkkkkkkkkkk.',
    ],
  },
};

export const npcUrl = (kind: NpcKind) => url(`npc:${kind}`, 16, 16, (p) => p.art(NPC_ART[kind].rows, NPC_ART[kind].palette));

// ―― 建物 ――

const STRUCTURES: Record<StructureKind, { rows: Grid; palette: Palette }> = {
  hut: {
    palette: { a: '#e0c060', b: '#c09a3c' },
    rows: [
      '................',
      '.......kk.......',
      '.....kkaakk.....',
      '...kkaaaaaakk...',
      '.kkaabaaaabaakk.',
      'kaaaaaaaaaaaaaak',
      'kkkkkkkkkkkkkkkk',
      '..knnnnnnnnnnk..',
      '..knnkkkkknnnk..',
      '..knnkxxxknnnk..',
      '..kddkxxxkddnk..',
      '..knnkxxxknnnk..',
      '..knnkxxxknddk..',
      '..kkkkkkkkkkkk..',
    ],
  },
  fort: {
    palette: { a: '#d0c8b8', b: '#a09888', c: '#807868' },
    rows: [
      '......k.........',
      '......krrrr.....',
      '......krrr......',
      '......k.........',
      'kkkk.kkkk.kkkk.k',
      'kaak.kaak.kabk.k',
      'kaakkkaakkkabkkk',
      'kaaabaaaabaaaabk',
      'kabaaaacaaaaabck',
      'kaaaaakkkkaaaack',
      'kabaakxxxxkabaak',
      'kaaaakxxxxkaaack',
      'kaacakxxxxkaabck',
      'kkkkkkkkkkkkkkkk',
    ],
  },
  trap: {
    palette: { a: '#c8c8d8', b: '#8a8a9a' },
    rows: [
      '................',
      '................',
      '................',
      '................',
      '................',
      '...k..k..k..k...',
      '..kak.kak.kak.k.',
      '..kak.kak.kak.k.',
      '.kbakkbakkbakk..',
      '.kbbbbbbbbbbbbk.',
      '.kddddddddddddk.',
      '..kkkkkkkkkkkk..',
    ],
  },
  smoke: {
    palette: { a: '#fff8e8', b: '#c8c8d4', c: '#9898a8' },
    rows: [
      '.......kkk......',
      '.....kkaaak.....',
      '....kaaaabbk....',
      '.....kabbbk.....',
      '.......kbbbk....',
      '......kbbcbk....',
      '.....kbbcck.....',
      '.....kbck.......',
      '......kk........',
      '......krk.......',
      '.....kryrk......',
      '....kkoyrkk.....',
      '...knnddnnnk....',
      '..kdnnkkddnnk...',
      '..kkkkkkkkkkk...',
    ],
  },
  raft: {
    palette: { a: '#fff8e8', b: '#d8d0c0' },
    rows: [
      '.......k........',
      '.......kkkk.....',
      '.......kaaak....',
      '.......kaaaak...',
      '.......kaabbk...',
      '.......kkkkk....',
      '.......k........',
      '.......k........',
      '.kkkkkkkkkkkkkk.',
      'knnndnnndnnndnnk',
      'kddnnnddnnnddnnk',
      'knnndnnndnnndnnk',
      '.kkkkkkkkkkkkkk.',
    ],
  },
};

export const structureUrl = (kind: StructureKind) =>
  url(`st:${kind}`, 16, 16, (p) => p.art(STRUCTURES[kind].rows, STRUCTURES[kind].palette, 0, 1));

// ―― 地図の目印 ――

const SHIP: Grid = [
  '.......k........',
  '.......krr......',
  '.......k........',
  '.....kkkkk......',
  '.....kwwwk......',
  '.....kwxwk......',
  '...kkkkkkkkk....',
  '...kwwxwwxwk....',
  'kkkkkkkkkkkkkkkk',
  'krrrrrrrrrrrrrrk',
  '.kwwwwwwwwwwwwk.',
  '..kwwwwwwwwwwk..',
  '...kkkkkkkkkk...',
];
const SINK: Grid = [
  '.......kk.......',
  '......kyyk......',
  '.....kyyyyk.....',
  '.....kyxxyk.....',
  '....kyyxxyyk....',
  '....kyyxxyyk....',
  '...kyyyxxyyyk...',
  '...kyyyyyyyyk...',
  '..kyyyyxxyyyyk..',
  '..kyyyyyyyyyyk..',
  '..kkkkkkkkkkkk..',
];
const SUPPLY: Grid = [
  '....kkkkkkkk....',
  '..kkwrwrwrwrkk..',
  '.kwrwrwrwrwrwrk.',
  '.kkkkkkkkkkkkkk.',
  '..k..k....k..k..',
  '...k.k....k.k...',
  '....kk....kk....',
  '....kkkkkkkk....',
  '....knnnnnnk....',
  '....kndnndnk....',
  '....knnddnnk....',
  '....kndnndnk....',
  '....kkkkkkkk....',
];

export const markUrl = (kind: 'smoke' | 'ship' | 'shipComing' | 'sink' | 'supply') => {
  if (kind === 'smoke') return structureUrl('smoke');
  return url(`mark:${kind}`, 16, 16, (p) => {
    if (kind === 'sink') p.art(SINK, {}, 0, 2);
    if (kind === 'supply') p.art(SUPPLY, {}, 0, 1);
    if (kind === 'ship') p.art(SHIP, {}, 0, 2);
    if (kind === 'shipComing') {
      p.art(SHIP, {}, 0, 2);
      p.ctx.globalCompositeOperation = 'source-atop';
      p.rect(0, 0, 16, 16, 'rgba(255,255,255,0.45)');
      p.ctx.globalCompositeOperation = 'source-over';
    }
  });
};

export const footprintUrl = () =>
  url('footprint', 16, 16, (p) => {
    const c = 'rgba(70,40,30,0.55)';
    for (const [x, y] of [[3, 3], [9, 6], [4, 10], [10, 12]]) {
      p.rect(x, y, 2, 2, c);
      p.rect(x - 1, y - 1, 1, 1, c);
      p.rect(x + 2, y - 1, 1, 1, c);
    }
  });

export const relicUrl = () =>
  url('relic', 16, 16, (p) =>
    p.art(
      ['..kkkk..', '.kaaaak.', 'kaakkaak', 'kakaakak', 'kaakkaak', 'kaaaaabk', 'kaaaaabk', 'kkkkkkkk'],
      { a: '#c8c0b0', b: '#a0988c' },
      8,
      0,
    ),
  );

export const bubbleUrl = () =>
  url('bubble', 16, 16, (p) =>
    p.art(['.kkkkkkkk.', 'kwwwwwwwwk', 'kwxwwxwwxk', 'kwwwwwwwwk', '.kkkkwkkk.', '.....kk...'], {}, 3, 0),
  );

export const worryUrl = () =>
  url('worry', 16, 16, (p) => p.art(['.k.', 'kyk', 'kyk', 'kyk', '.k.', 'kyk', '.k.'], {}, 13, 0));

/** 自分の頭の上の印 */
export const arrowUrl = () =>
  url('arrow', 16, 16, (p) => p.art(['kkkkkkkkk', 'kyyyyyyyk', '.kyyyyyk.', '..kyyyk..', '...kyk...', '....k....'], {}, 3, 0));

// ―― 小さな絵（所持品や画面の飾り）――

const SHAPES: Record<string, Grid> = {
  ball: ['............', '.....kk.....', '...kkgkkk...', '..kaaaaaak..', '.kawaaaaabk.', '.kawaaaaabk.', '.kaaaaaaabk.', '.kaaaaaabbk.', '..kaaabbbk..', '...kkkkkk...'],
  mushroom: ['............', '...kkkkkk...', '..kaawaaak..', '.kaaaaawaak.', '.kawaaaaaak.', '.kkkkkkkkkk.', '....kbbk....', '....kbbk....', '....kbbk....', '....kkkk....'],
  jar: ['............', '...kkkkkk...', '...kbbbbk...', '...kkkkkk...', '..kaaaaaak..', '.kawaaaaabk.', '.kawaaaaabk.', '.kaaaaaaabk.', '.kaaaaaaabk.', '..kkkkkkkk..'],
  bottle: ['....kkkk....', '....kbbk....', '....kaak....', '....kaak....', '...kaaaak...', '..kawaaabk..', '..kawaaabk..', '..kaaaaabk..', '..kaaaaabk..', '...kkkkkk...'],
  leaf: ['.........kk.', '.......kkak.', '.....kkaaak.', '....kaawaak.', '...kaawaaak.', '..kaawaaak..', '..kawaaak...', '..kaaakk....', '.kkkkk......', 'kk..........'],
  fish: ['............', '............', '...kkkkk...k', '..kaaaaakkak', '.kawaaaaakak', 'kaeaaaaaaabk', '.kaaaaabbkak', '..kbbbbbkkak', '...kkkkk...k', '............'],
  meat: ['............', '...kkkkk....', '..kaaaaak...', '.kawaaaaak..', '.kaaaaaaaak.', '.kaaaaaabbk.', '..kaaabbbkk.', '...kkkkkkwwk', '.........kwk', '..........k.'],
  log: ['............', '............', '.kkkkkkkkk..', 'kaaaaaaaaakk', 'kbbaabbaabwk', 'kaabbaaaakwk', 'kaaaaabbaawk', '.kkkkkkkkkk.', '............', '............'],
  rock: ['............', '............', '....kkkk....', '..kkaaaak...', '.kawaaaabk..', '.kaaaaaabbk.', 'kaaaaaabbbk.', 'kaaabbbbbbk.', '.kkkkkkkkk..', '............'],
  nails: ['............', '.kkk...kkk..', '..k.....k...', '..a.....a...', '..a..kkka...', '..a...k.a...', '..a...a.a...', '..k...a.k...', '......a.....', '......k.....'],
  knife: ['..........kk', '.........kak', '........kaak', '.......kaak.', '......kaak..', '.....kabk...', '..kkkkbk....', '...kdkk.....', '..kdnk......', '.kdnk.......', '.kkk........'],
  axe: ['....kkkk....', '...kaaaak...', '..kaaaaaakk.', '..kaabkkndk.', '...kkk.kndk.', '.......kndk.', '......kndk..', '.....kndk...', '....kndk....', '...kndk.....', '...kkk......'],
  spear: ['.........kkk', '........kaak', '.......kaabk', '.......kabk.', '......kndkk.', '.....kndk...', '....kndk....', '...kndk.....', '..kndk......', '.kndk.......', '.kkk........'],
  bow: ['...kkk......', '...knnk...k.', '....kdnk..k.', '.....kdnk.k.', '......kdk.k.', '......kdkkk.', '......kdk.k.', '.....kdnk.k.', '....kdnk..k.', '...knnk...k.', '...kkk......'],
  torch: ['.....k......', '....kyk.....', '...kyoyk....', '...koyok....', '....krk.....', '....knk.....', '....knk.....', '....kdk.....', '....kdk.....', '....kdk.....', '....kkk.....'],
  cloth: ['............', '.kkkkkkkkkk.', '.kaaaaaaaak.', '.kabaaaabak.', '.kaaaaaaaak.', '.kaabaabaak.', '.kaaaaaaaak.', '.kabaaaaaak.', '.kkkkakkakk.', '.....k..k...'],
  rope: ['............', '....kkkk....', '..kkaabakk..', '.kabkkkkaak.', '.kak....kbk.', '.kak....kak.', '.kbkkkkkabk.', '..kkaabakk..', '....kkkk....', '............'],
  compass: ['............', '....kkkk....', '..kkwwwwkk..', '.kwwwrrwwwk.', '.kwwwrrwwwk.', '.kwwxxwwwwk.', '.kwwxxwwwwk.', '..kkwwwwkk..', '....kkkk....', '............'],
  map: ['............', '.kkkkkkkkkk.', '.kaaaaaabak.', '.kaakkaaaak.', '.kakbbkaabk.', '.kakbbkaaak.', '.kaakkaarak.', '.kaaaaaaaak.', '.kkkkkkkkkk.', '............'],
  binoculars: ['............', '..kkk..kkk..', '.kaaak.kaak.', '.kaaakkkaak.', '.kbbbkkkbbk.', '.kaaak.kaak.', '.kaaak.kaak.', '.kwwwk.kwwk.', '..kkk..kkk..', '............'],
  pot: ['............', '.....kk.....', '...kkkkkk...', 'kkkaaaaaakkk', 'k.kawaaaak.k', 'kkkawaaabkkk', '..kaaaaabk..', '..kaaaabbk..', '...kkkkkk...', '............'],
  matches: ['.r....r...r.', '.k....k...k.', '.n....n...n.', '.n....n...n.', 'kkkkkkkkkkkk', 'kaaaaaaaaaak', 'kawwwwwwwwak', 'kawxxwwxxwak', 'kaaaaaaaaaak', 'kkkkkkkkkkkk'],
  backpack: ['....kkkk....', '...kk..kk...', '..kaaaaaak..', '.kaaawaaabk.', '.kaaaaaaabk.', '.kkkkkkkkkk.', '.kaakyykaak.', '.kaaaaaaabk.', '.kaaaaaabbk.', '..kkkkkkkk..'],
  shell: ['............', '....kkkk....', '..kkaabakk..', '.kabaabaabk.', '.kaabaabaak.', '.kbaabaabak.', '..kaabaabk..', '...kaabak...', '....kkkk....', '............'],
  feather: ['.........kk.', '.......kkak.', '......kaabk.', '.....kaabk..', '....kaabak..', '...kaabak...', '...kabak....', '..kkkkk.....', '.kk.........', 'kk..........'],
  plate: ['....kkkk....', '...kyyyyk...', '..kkyyyykk..', '.kaaaaaaaak.', '.kaaraagaak.', '.kaaaaaaaak.', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', '.kbbbbbbbbk.', '..kkkkkkkk..'],
  gear: ['....kkkk....', '.k.kaabak.k.', '.kkaaaaaakk.', '..kaakkaak..', 'kkaak..kaakk', 'kaaak..kaabk', '..kaakkabk..', '.kkaaaabbkk.', '.k.kabbbk.k.', '....kkkk....'],
  rod: ['.........kk.', '........kn.k', '.......kn..k', '......kn...k', '.....kn....k', '....kn.....k', '...kn......k', '..kd.....kkk', '.kd......krk', 'kk........k.'],
  sack: ['....kkkk....', '...kaaaak...', '....kbbk....', '...kaaaak...', '..kaaaaaak..', '.kaawwwwaak.', '.kaawwwwabk.', '.kaaaaaaabk.', '.kaaaaabbbk.', '..kkkkkkkk..'],
  canteen: ['....kkkk....', '....knnk....', '..kkkkkkkk..', '.kaaaaaaabk.', '.kawaaaaabk.', '.kbbbbbbbbk.', '.kaaaaaaabk.', '.kaaaaaaabk.', '.kaaaaaabbk.', '..kkkkkkkk..'],
  sail: ['.....k......', '.....kk.....', '.....kak....', '.....kaak...', '.....kawak..', '.....kaaak..', '.....kaaabk.', '.....kaabbk.', '.....kkkkkk.', '.....k......'],
  line: ['............', '...kkkkkk...', '..kaaaaaak..', '.kakkkkkkak.', '.kak.kk.kak.', '.kak.kk.kak.', '.kakkkkkkak.', '..kaaaaaak..', '...kkkkkk...', '..........k.'],
};

const ITEM_ART: Record<ItemId, [keyof typeof SHAPES, string, string, Palette?]> = {
  wood: ['log', '#b07a44', '#7a4a28'],
  fruit: ['ball', '#f05a4a', '#b83030', { g: '#5db548' }],
  mushroom: ['mushroom', '#e0483e', '#fff0d8'],
  honey: ['jar', '#ffc62e', '#d88a14'],
  medicinal_herb: ['leaf', '#30c090', '#1e8e68'],
  shell: ['shell', '#f8c8c0', '#d88a90'],
  cloth: ['cloth', '#e8e0d0', '#b8a890'],
  rope_scrap: ['rope', '#c8a468', '#967440'],
  bottle: ['bottle', '#90dcd0', '#5ca8a0'],
  fish: ['fish', '#7cb8e8', '#4a84c0'],
  wreck_part: ['gear', '#a8a8b8', '#747488'],
  grass: ['leaf', '#a2e36e', '#5db548'],
  herb: ['leaf', '#5db548', '#3a8c3e'],
  nut: ['ball', '#b07a44', '#7a4a28', { g: '#7a4a28' }],
  stone: ['rock', '#b8b4a8', '#807c74'],
  flint: ['rock', '#5c6074', '#3a3c4c'],
  egg: ['ball', '#fff4e0', '#e0ccac', { g: '#fff4e0' }],
  ore: ['rock', '#7c94c8', '#5068a0'],
  big_feather: ['feather', '#fff8e8', '#c0b8d0'],
  water: ['bottle', '#5cc4f0', '#2f8bd0'],
  rope: ['rope', '#e0bc78', '#a8844c'],
  stone_knife: ['knife', '#b8b4a8', '#807c74'],
  stone_axe: ['axe', '#b8b4a8', '#807c74'],
  spear: ['spear', '#b8b4a8', '#807c74'],
  bow: ['bow', '#a8703c', '#7a4a28'],
  torch: ['torch', '#ffd24a', '#f08a2c'],
  bandage: ['cloth', '#fff8e8', '#e0483e'],
  sail: ['sail', '#fff8e8', '#c8c0b0'],
  shell_husk: ['shell', '#e8e0d0', '#b8a890'],
  fishing_line: ['line', '#e8e8f0', '#b0b0c0'],
  fishing_rod: ['rod', '#a8703c', '#7a4a28'],
  canteen: ['canteen', '#6a8a4a', '#4c6a34'],
  island_lord: ['fish', '#ffd24a', '#d89a14'],
  meat: ['meat', '#e0605a', '#a83a3a'],
  dried_fish: ['fish', '#c8a468', '#967440'],
  nails: ['nails', '#a8a8b8', '#747488'],
  antiseptic: ['bottle', '#f0a0c0', '#c86c90'],
  medicine: ['jar', '#fff8e8', '#e0483e'],
  compass: ['compass', '#fff8e8', '#c0b8a8'],
  map_fragment: ['map', '#f6dc8e', '#c8a468', { b: '#5db548' }],
  binoculars: ['binoculars', '#5c6074', '#3a3c4c'],
  pot: ['pot', '#8a8a9a', '#5c5c6c'],
  salt: ['sack', '#d8c8a0', '#a89870'],
  matches: ['matches', '#e0483e', '#a82c2c'],
  survival_knife: ['knife', '#e8e8f4', '#a8a8bc'],
  backpack: ['backpack', '#c0683c', '#8a4828'],
  full_course: ['plate', '#ffe08a', '#c0b8a8', { g: '#5db548' }],
};

export const itemUrl = (item: ItemId) => {
  const [shape, a, b, extra] = ITEM_ART[item];
  return url(`item:${item}`, 12, 12, (p) => p.art(SHAPES[shape], { a, b, ...extra }, 0, 1));
};

const ICONS: Record<string, { rows: Grid; palette?: Palette }> = {
  heart: { rows: ['............', '..kkk..kkk..', '.krrrkkrrrk.', 'krwrrrrrrrak', 'krwrrrrrrrak', 'krrrrrrrraak', '.krrrrrraak.', '..krrrraak..', '...krraak...', '....kaak....', '.....kk.....'], palette: { a: '#a82c2c' } },
  hunger: { rows: SHAPES.meat, palette: { a: '#e0a060', b: '#b87838' } },
  water: { rows: ['.....kk.....', '.....kk.....', '....kaak....', '....kaak....', '...kaaaak...', '..kawaaabk..', '.kawaaaaabk.', '.kawaaaaabk.', '.kaaaaaabbk.', '..kaaabbbk..', '...kkkkkk...'], palette: { a: '#5cc4f0', b: '#2f8bd0' } },
  ap: { rows: ['.......kkk..', '......kyyk..', '.....kyyk...', '....kyyk....', '...kyyyykk..', '..kkkkyyyk..', '.....kyyk...', '....kyyk....', '...kyyk.....', '..kyk.......', '..kk........'] },
  sun: { rows: ['.....yy.....', '.y...yy...y.', '..y.kkkk.y..', '...kyyyyk...', '..kyyyyyyk..', 'yykyyyyyykyy', 'yykyyyyyykyy', '..kyyyyyyk..', '...kyyyyk...', '..y.kkkk.y..', '.y...yy...y.', '.....yy.....'] },
  moon: { rows: ['....kkkk....', '..kkyyyk....', '.kyyyyk.....', '.kyyyk......', 'kyyyk.......', 'kyyyk.......', 'kyyyyk......', 'kyyyyyk...k.', '.kyyyyykkyk.', '.kkyyyyyyyk.', '...kkyyyk...', '.....kkk....'] },
  rain: { rows: ['....kkkk....', '..kkaaaakk..', '.kaaaaaaaak.', 'kaaaaaaaaabk', 'kaaaaaabbbbk', '.kkkkkkkkkk.', '..c...c...c.', '.c...c...c..', '...c...c....', '..c...c.....'], palette: { a: '#d0d8e8', b: '#a0a8c0', c: '#3a7fe0' } },
  storm: { rows: ['....kkkk....', '..kkaaaakk..', '.kaaaaaaaak.', 'kaaaaaaaaabk', 'kaabbbbbbbbk', '.kkkkkkkkkk.', '.c...kyk..c.', 'c...kyk...c.', '...kyyyk.c..', '.....kyk....', '.....kk.....'], palette: { a: '#8c94a8', b: '#5c6478', c: '#3a7fe0' } },
  gather: { rows: ['...kkkkkk...', '..k......k..', '.k........k.', 'kkkkkkkkkkkk', 'knnnnnnnnnnk', 'kndnndnndnnk', 'knnnnnnnnnnk', '.kdnnddnndk.', '.kdddddddnk.', '..kkkkkkkk..'] },
  undo: { rows: ['............', '...kk.......', '..kyk.......', '.kyykkkkk...', 'kyyyyyyyyk..', '.kyykkkkyyk.', '..kyk...kyk.', '...kk...kyk.', '....kkkkyyk.', '....kyyyyk..', '....kkkkk...'] },
  check: { rows: ['............', '.........kk.', '........kyk.', '.......kyyk.', '.kk...kyyk..', 'kyyk.kyyk...', 'kyyyyyyk....', '.kyyyyk.....', '..kyyk......', '...kk.......'] },
  rest: { rows: ['..kkkkkk....', '..kyyyyk....', '.....kyk.kkk', '....kyk..kyk', '...kyk..kyk.', '..kyyyyk.kkk', '..kkkkkk....', '......kkk...', '......kyk...', '.....kyk....', '.....kkk....'] },
  guard: { rows: ['.kkkkkkkkkk.', 'kaaaaawbbbbk', 'kaaaaawbbbbk', 'kaaaaawbbbbk', 'kaaaaawbbbbk', 'kwwwwwwwwwwk', 'kbbbbbwaaaak', '.kbbbbwaaak.', '..kbbbwaak..', '...kbbwak...', '....kkkk....'], palette: { a: '#3a7fe0', b: '#2756a8' } },
  hide: { rows: ['............', '...kkkkk....', '..kaaaaakkk.', '.kawaaaaaaak', '.kaaaaaaabak', 'kaaawaaaaabk', 'kaaaaaabaabk', 'kaaabaaaabbk', '.kkkkkkkkkk.'], palette: { a: '#5db548', b: '#3a8c3e' } },
  ambush: { rows: ['............', '...kkkkkk...', '.kkwwwwwwkk.', 'kwwwaaaawwwk', 'kwwaaxxaawwk', 'kwwaaxxaawwk', 'kwwwaaaawwwk', '.kkwwwwwwkk.', '...kkkkkk...'], palette: { a: '#e0483e' } },
  people: { rows: ['...kkk......', '..kaaak.kkk.', '..kaaakkbbbk', '...kkk.kbbbk', '..kkkkk.kkk.', '.kaaaaakkkkk', '.kaaaaakbbbk', '.kaaaaakbbbk', '.kkkkkkkkkkk'], palette: { a: '#e0483e', b: '#3a7fe0' } },
  key: { rows: ['..kkkk......', '.kyyyyk.....', 'kyykkyyk....', 'kykkkkyk....', 'kyykkyyk....', '.kyyyykk....', '..kkkkyykk..', '......kyyykk', '.......kykyk', '.......kk.k.'] },
  scroll: { rows: ['.kkkkkkkkk..', 'kaaaaaaaaak.', 'kkkkkkkkaak.', '..kaaaaakak.', '..kaxxxakak.', '..kaaaaakak.', '..kaxxxakak.', '..kaaaaakkk.', '.kkkkkkkkaak', '.kaaaaaaaaak', '..kkkkkkkkk.'], palette: { a: '#f6dc8e' } },
  chest: { rows: ['............', '..kkkkkkkk..', '.knnnnnnnnk.', 'knnnnnnnnnnk', 'kddddyyddddk', 'kkkkkyykkkkk', 'knnnnyynnnnk', 'knnnnnnnnnnk', 'kddddddddddk', 'kkkkkkkkkkkk'] },
  crown: { rows: ['............', '.y...yy...y.', 'kyk.kyyk.kyk', 'kyykyyyykyyk', 'kyyyyyyyyyyk', 'kyyryyyryyyk', 'kyyyyyyyyyyk', 'koooooooooook', 'kkkkkkkkkkkk'] },
  wave: { rows: ['............', '..kkk.......', '.kaaak...kk.', 'kaawaak.kaak', 'kaaaaaakaaak', 'kaaaaaaaaaak', 'kaabaaaabaak', 'kaaaaaaaaaak', 'kkkkkkkkkkkk'], palette: { a: '#5cc4f0', b: '#2f8bd0' } },
  ghost: { rows: GHOST.slice(1, 13).map((row) => row.slice(2, 14)), palette: { q: '#e090a0' } },
  curse: { rows: ['............', '...kkkkkk...', '..kaaaaaak..', '.kaxaaaaxak.', '.kaaxaaxaak.', '.kaaaaaaaak.', '.kaaaxxaaak.', '..kaaaaaak..', '...kkkkkk...'], palette: { a: '#b070d8' } },
  fog: { rows: ['............', '..kkkkkk....', '.kaaaaaakkk.', 'kaaaaaaaaaak', 'kaaaaaaaaabk', '.kkkkkkkkkk.', '............', '.bbbbb..bbb.', '............', '..bbb.bbbbb.'], palette: { a: '#d0d8e8', b: '#a0a8c0' } },
  noise: { rows: ['............', '...k....kk..', '..kak...k.k.', '.kaak.k...k.', 'kaaak..k..k.', 'kaaak..k..k.', '.kaak.k...k.', '..kak...k.k.', '...k....kk..'], palette: { a: '#f0a050' } },
  lure: { rows: SHAPES.meat, palette: { a: '#e0605a', b: '#a83a3a' } },
  bless: { rows: ['.....kk.....', '.....kk.....', '...kkyykk...', '.kkyyyyyykk.', '.kyyywwyyyk.', '...kyyyyk...', '..kyykkyyk..', '..kyk..kyk..', '..kk....kk..'] },
  flag: { rows: ['.kkkkkkkk...', '.krrrrrrrk..', '.krrrrrrrrk.', '.krrrrrrrk..', '.kkkkkkkk...', '.k..........', '.k..........', '.k..........', '.k..........', '.k..........'] },
};

export const iconUrl = (name: keyof typeof ICONS) =>
  url(`icon:${String(name)}`, 12, 12, (p) => p.art(ICONS[name].rows, ICONS[name].palette));

export const weatherIcon = (weather: Weather) => iconUrl(weather === 'sunny' ? 'sun' : weather);

/** 雨粒。マップの上に敷き詰めて流す */
export const rainUrl = () =>
  url('rain', 32, 32, (p) => {
    const c = 'rgba(190,225,255,0.85)';
    for (const [x, y] of [[3, 2], [14, 9], [25, 4], [8, 18], [20, 22], [29, 15], [12, 28], [1, 25]]) {
      p.rect(x, y, 1, 4, c);
    }
  });

/** ボタンや飾りの <img>。alt は飾りなので空 */
export function spriteImg(src: string, className = 'sprite'): HTMLImageElement {
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.className = className;
  img.draggable = false;
  return img;
}
