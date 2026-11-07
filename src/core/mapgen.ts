// 3.4 ランダム生成。同じシードと人数からは必ず同じ島ができる。
import {
  MAP_CONFIG,
  MAP_RATIOS,
  MAX_MAP_ATTEMPTS,
  MAX_WATER_DISTANCE,
  MIN_SPECIAL_DISTANCE_FROM_START,
  SEA_MARGIN,
  SPECIAL_PLACEMENT,
  SPECIAL_TERRAINS,
  WATER_TERRAINS,
} from './data';
import { Rng } from './rng';
import type { GameMap, MapSize, Point, SpecialTerrainId, TerrainId } from './types';

const NEIGHBORS_4 = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
const NEIGHBORS_8 = [...NEIGHBORS_4, [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

const smooth = (t: number) => t * t * (3 - 2 * t);

function makeNoise(rng: Rng, cells: number): (u: number, v: number) => number {
  const stride = cells + 2;
  const lattice = Array.from({ length: stride * stride }, () => rng.next());
  return (u, v) => {
    const fx = u * cells;
    const fy = v * cells;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const at = (x: number, y: number) => lattice[y * stride + x];
    const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
    const bottom = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

/** 上下左右の歩数。海は通らない */
export function walkDistances(terrain: readonly TerrainId[], width: number, from: number): number[] {
  const distances = new Array<number>(terrain.length).fill(-1);
  const queue = [from];
  distances[from] = 0;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const x = current % width;
    const y = Math.floor(current / width);
    for (const [dx, dy] of NEIGHBORS_4) {
      const next = y + dy >= 0 && x + dx >= 0 && x + dx < width ? (y + dy) * width + x + dx : -1;
      if (next < 0 || next >= terrain.length) continue;
      if (terrain[next] === 'sea' || distances[next] !== -1) continue;
      distances[next] = distances[current] + 1;
      queue.push(next);
    }
  }
  return distances;
}

/** 手順6 の公平性チェック。問題がなければ空配列を返す */
export function checkFairness(map: GameMap, playerCount: number, mapSize: MapSize = 'small'): string[] {
  const { terrain, width, height, starts } = map;
  const issues: string[] = [];
  const land = terrain.flatMap((t, i) => (t === 'sea' ? [] : [i]));
  if (land.length === 0) return ['陸地がない'];

  const reach = walkDistances(terrain, width, land[0]);
  if (land.some((i) => reach[i] === -1)) issues.push('陸地がつながっていない');

  for (let i = 0; i < terrain.length; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    if (onEdge && terrain[i] !== 'sea') issues.push('外周が海ではない');
  }

  if (starts.length !== playerCount) issues.push('初期位置の数が足りない');
  for (const start of starts) {
    const index = start.y * width + start.x;
    if (terrain[index] !== 'beach') issues.push('初期位置が砂浜ではない');
    const distances = walkDistances(terrain, width, index);
    const nearest = Math.min(
      ...terrain.flatMap((t, i) => (WATER_TERRAINS.includes(t) && distances[i] >= 0 ? [distances[i]] : [Infinity])),
    );
    if (nearest > MAX_WATER_DISTANCE) issues.push('水源まで遠い初期位置がある');
  }

  const specials = terrain.filter((t) => (SPECIAL_TERRAINS as readonly TerrainId[]).includes(t)).length;
  if (specials < MAP_CONFIG[playerCount][mapSize].specials) issues.push('特殊マスが足りない');
  return issues;
}

function tryGenerate(rng: Rng, playerCount: number, mapSize: MapSize, attempts: number): GameMap | null {
  const config = MAP_CONFIG[playerCount][mapSize];
  const width = config.size + SEA_MARGIN * 2;
  const height = width;
  const total = width * height;
  const coarse = makeNoise(rng, 3);
  const fine = makeNoise(rng, 7);
  const vegetation = makeNoise(rng, 3);

  // 手順1：中心からの距離とノイズで高さを作り、高い順に陸地にする
  const elevation = new Array<number>(total).fill(-1);
  const inner: number[] = [];
  const half = (width - 1) / 2;
  for (let y = SEA_MARGIN; y < height - SEA_MARGIN; y++) {
    for (let x = SEA_MARGIN; x < width - SEA_MARGIN; x++) {
      const nx = (x - half) / (config.size / 2);
      const ny = (y - half) / (config.size / 2);
      const falloff = 1 - Math.hypot(nx, ny) / Math.SQRT2;
      const noise = coarse(x / width, y / height) * 0.65 + fine(x / width, y / height) * 0.35;
      const index = y * width + x;
      elevation[index] = falloff * 0.6 + noise * 0.4;
      inner.push(index);
    }
  }
  const byHeight = [...inner].sort((a, b) => elevation[b] - elevation[a] || a - b);
  const terrain = new Array<TerrainId>(total).fill('sea');
  for (const index of byHeight.slice(0, config.land)) terrain[index] = 'grass';

  // 内側に閉じ込められた海は島の一部にする（外周の海とつながらない海を作らない）
  const openSea = new Set<number>([0]);
  const seaQueue = [0];
  for (let head = 0; head < seaQueue.length; head++) {
    const current = seaQueue[head];
    const x = current % width;
    const y = Math.floor(current / width);
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (terrain[next] === 'sea' && !openSea.has(next)) {
        openSea.add(next);
        seaQueue.push(next);
      }
    }
  }
  for (let i = 0; i < total; i++) if (terrain[i] === 'sea' && !openSea.has(i)) terrain[i] = 'grass';

  const neighbors = (index: number, offsets: readonly (readonly [number, number])[]) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return offsets.map(([dx, dy]) => (y + dy) * width + x + dx).filter((n) => n >= 0 && n < total);
  };

  // 陸地が分かれている島は、この先の距離計算ができないので早めに作り直す
  const landCells = terrain.flatMap((t, i) => (t === 'sea' ? [] : [i]));
  const reach = walkDistances(terrain, width, landCells[0]);
  if (landCells.some((i) => reach[i] === -1)) return null;

  // 手順2：高さで地形を割り当てる。砂浜は海に面したマスの低い順
  const ascending = [...landCells].sort((a, b) => elevation[a] - elevation[b] || a - b);
  const coast = ascending.filter((i) => neighbors(i, NEIGHBORS_8).some((n) => terrain[n] === 'sea'));
  for (const index of coast.slice(0, Math.round(landCells.length * MAP_RATIOS.beach))) terrain[index] = 'beach';

  const descending = [...ascending].reverse().filter((i) => terrain[i] !== 'beach');
  const mountainCount = Math.max(1, Math.round(landCells.length * MAP_RATIOS.mountain));
  const rockCount = Math.round(landCells.length * MAP_RATIOS.rock);
  descending.slice(0, mountainCount).forEach((i) => (terrain[i] = 'mountain'));
  descending.slice(mountainCount, mountainCount + rockCount).forEach((i) => (terrain[i] = 'rock'));
  const rest = descending.slice(mountainCount + rockCount);
  const vegetationAt = (i: number) => vegetation((i % width) / width, Math.floor(i / width) / height);
  [...rest]
    .sort((a, b) => vegetationAt(b) - vegetationAt(a) || a - b)
    .slice(0, Math.round(rest.length * MAP_RATIOS.forestOfRest))
    .forEach((i) => (terrain[i] = 'forest'));

  // 手順3：山から海へ川を1本通す
  let current = rng.pick(descending.slice(0, mountainCount));
  const visited = new Set<number>([current]);
  for (let reachedSea = false; !reachedSea; ) {
    const options = neighbors(current, NEIGHBORS_4).filter((n) => !visited.has(n));
    if (options.length === 0) return null;
    const next = options.reduce((best, n) => (elevation[n] < elevation[best] ? n : best));
    if (terrain[next] === 'sea') {
      reachedSea = true;
    } else {
      if (terrain[next] !== 'mountain') terrain[next] = 'river';
      visited.add(next);
      current = next;
    }
  }

  // 泉は他の水源からなるべく離して置く
  const waterCells = () => terrain.flatMap((t, i) => (WATER_TERRAINS.includes(t) ? [i] : []));
  const springCount = rng.int(config.springs.min, config.springs.max);
  for (let n = 0; n < springCount; n++) {
    const candidates = terrain.flatMap((t, i) => (t === 'grass' || t === 'forest' ? [i] : []));
    if (candidates.length === 0) return null;
    const water = waterCells().map((i) => walkDistances(terrain, width, i));
    const score = (i: number) => Math.min(...water.map((d) => (d[i] < 0 ? Infinity : d[i])));
    const best = Math.max(...candidates.map(score));
    terrain[rng.pick(candidates.filter((i) => score(i) >= best - 1))] = 'spring';
  }

  // 手順5：砂浜に初期位置を、互いの距離が最大になるように置く
  // （仕様の手順4「特殊マス」はプレイヤー間の距離で決めるので、初期位置を先に決める）
  const beaches = terrain.flatMap((t, i) => (t === 'beach' ? [i] : []));
  if (beaches.length < playerCount) return null;
  const beachDistances = new Map(beaches.map((b) => [b, walkDistances(terrain, width, b)]));
  let starts: number[] = [];
  let bestSpread = -1;
  for (const first of beaches) {
    const chosen = [first];
    while (chosen.length < playerCount) {
      let pick = -1;
      let pickScore = -1;
      for (const b of beaches) {
        if (chosen.includes(b)) continue;
        const s = Math.min(...chosen.map((c) => beachDistances.get(c)![b]));
        if (s > pickScore) {
          pickScore = s;
          pick = b;
        }
      }
      chosen.push(pick);
    }
    let spread = Infinity;
    for (let a = 0; a < chosen.length; a++) {
      for (let b = a + 1; b < chosen.length; b++) {
        spread = Math.min(spread, beachDistances.get(chosen[a])![chosen[b]]);
      }
    }
    if (spread > bestSpread) {
      bestSpread = spread;
      starts = chosen;
    }
  }

  // 手順4：特殊マスを、プレイヤー間の距離がなるべく等しい位置に置く
  // 3.2 の「1〜3箇所」は種類ごとの数、4.5 の「4か所以上」は合計と読む
  const startDistances = starts.map((s) => beachDistances.get(s)!);
  const kinds: SpecialTerrainId[] = [...SPECIAL_TERRAINS];
  while (kinds.length < config.specials) kinds.push(rng.pick(SPECIAL_TERRAINS));
  const placed: number[] = [];
  for (const kind of kinds) {
    const usable = (i: number) => {
      const t = terrain[i];
      if (t === 'sea' || t === 'mountain' || WATER_TERRAINS.includes(t) || placed.includes(i)) return false;
      if ((SPECIAL_TERRAINS as readonly TerrainId[]).includes(t)) return false;
      return startDistances.every((d) => d[i] >= MIN_SPECIAL_DISTANCE_FROM_START);
    };
    const all = landCells.filter(usable);
    const themed = all.filter((i) => SPECIAL_PLACEMENT[kind].includes(terrain[i]));
    const apart = (cells: number[]) => cells.filter((i) => {
      const x = i % width;
      const y = Math.floor(i / width);
      return placed.every((p) => Math.abs(p % width - x) + Math.abs(Math.floor(p / width) - y) >= 3);
    });
    const candidates = [apart(themed), apart(all), themed, all].find((c) => c.length > 0);
    if (!candidates) return null;
    const unevenness = (i: number) => {
      const distances = startDistances.map((d) => d[i]);
      return Math.max(...distances) - Math.min(...distances);
    };
    const ranked = [...candidates].sort((a, b) => unevenness(a) - unevenness(b) || a - b);
    const chosen = rng.pick(ranked.slice(0, 3));
    terrain[chosen] = kind;
    placed.push(chosen);
  }

  const startPoints: Point[] = starts.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
  return { width, height, terrain, elevation, starts: startPoints, attempts };
}

export function generateMap(rng: Rng, playerCount: number, mapSize: MapSize = 'small'): GameMap {
  if (!MAP_CONFIG[playerCount]) throw new Error(`対応していない人数です: ${playerCount}`);
  for (let attempt = 1; attempt <= MAX_MAP_ATTEMPTS; attempt++) {
    const map = tryGenerate(rng, playerCount, mapSize, attempt);
    if (map && checkFairness(map, playerCount, mapSize).length === 0) return map;
  }
  throw new Error('公平な島を生成できませんでした');
}
