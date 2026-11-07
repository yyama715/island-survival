import { describe, expect, it } from 'vitest';
import {
  AP_PER_TURN,
  applyAction,
  checkFairness,
  createGame,
  generateMap,
  getPlayerView,
  hashSeed,
  INVENTORY_SLOTS,
  MAP_CONFIG,
  Rng,
  STACK_SIZE,
  TERRAIN,
  type Action,
  type Direction,
  type GameEvent,
  type GameState,
  type MapSize,
  type TerrainId,
} from './index';
import { adjustedWeights, cellIndex, walk } from './testing';

const ME = 0;
const ALL_MAPS = [3, 4, 5].flatMap((count) =>
  (['small', 'medium', 'large'] as MapSize[]).map((size): [number, MapSize] => [count, size]),
);

/** 主人公の周りの地形を自由に書き換えたテスト用の状態を作る */
function sandbox(terrainHere: TerrainId, playerCount = 3): GameState {
  const state = createGame('sandbox', playerCount);
  const me = state.players[ME];
  me.x = Math.floor(state.map.width / 2);
  me.y = Math.floor(state.map.height / 2);
  state.map.terrain[cellIndex(state, me.x, me.y)] = terrainHere;
  me.ap = 99;
  return state;
}

function gatherMany(state: GameState, times: number): { state: GameState; events: GameEvent[] } {
  let current = state;
  const events: GameEvent[] = [];
  for (let i = 0; i < times; i++) {
    const result = applyAction(current, { type: 'gather', playerId: ME });
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

describe('乱数', () => {
  it('同じ状態からは同じ列になる', () => {
    const a = new Rng(hashSeed('abc'));
    const b = new Rng(hashSeed('abc'));
    expect(Array.from({ length: 20 }, () => a.next())).toEqual(Array.from({ length: 20 }, () => b.next()));
  });

  it('int は範囲内の整数を返す', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(2, 5);
      expect(Number.isInteger(value) && value >= 2 && value <= 5).toBe(true);
    }
  });
});

describe('マップ生成', () => {
  it.each(ALL_MAPS)('%i人・%s：同じシードで同じ島になる', (count, size) => {
    expect(createGame('again', count, size)).toEqual(createGame('again', count, size));
  });

  it('違うシードでは違う島になる', () => {
    expect(createGame('one', 3).map.terrain).not.toEqual(createGame('two', 3).map.terrain);
  });

  it('広さを指定しなければ小になる', () => {
    expect(createGame('default', 4)).toEqual(createGame('default', 4, 'small'));
  });

  it.each([3, 4, 5])('%i人：小→中→大の順に島が広くなる', (count) => {
    const land = (size: MapSize) => createGame('grow', count, size).map.terrain.filter((t) => t !== 'sea').length;
    expect(land('small')).toBeLessThan(land('medium'));
    expect(land('medium')).toBeLessThan(land('large'));
  });

  it.each(ALL_MAPS)('%i人・%s：300シードすべてが公平性チェックを通り、陸地の数が目安どおり', (count, size) => {
    const config = MAP_CONFIG[count][size];
    for (let seed = 0; seed < 300; seed++) {
      const map = generateMap(new Rng(hashSeed(`fair-${seed}`)), count, size);
      expect(checkFairness(map, count, size)).toEqual([]);
      const land = map.terrain.filter((t) => t !== 'sea').length;
      expect(land).toBeGreaterThanOrEqual(config.land);
      expect(land).toBeLessThanOrEqual(config.land * 1.1);
      expect(map.width).toBe(config.size + 2);
    }
  });

  it.each(ALL_MAPS)('%i人・%s：必要な地形がすべて揃い、特殊マスは指定の数以上', (count, size) => {
    for (let seed = 0; seed < 100; seed++) {
      const { terrain } = generateMap(new Rng(hashSeed(`kinds-${seed}`)), count, size);
      for (const needed of ['beach', 'grass', 'forest', 'rock', 'mountain', 'river', 'spring'] as TerrainId[]) {
        expect(terrain).toContain(needed);
      }
      const specials = terrain.filter((t) => t === 'cave' || t === 'wreck' || t === 'ruins');
      expect(specials.length).toBeGreaterThanOrEqual(MAP_CONFIG[count][size].specials);
      expect(new Set(specials).size).toBe(3);
    }
  });

  it('公平性チェックは問題のある島を見つける', () => {
    const map = generateMap(new Rng(1), 3);
    const noWater = { ...map, terrain: map.terrain.map((t) => (t === 'river' || t === 'spring' ? 'grass' : t)) as TerrainId[] };
    expect(checkFairness(noWater, 3)).toContain('水源まで遠い初期位置がある');
    const offEdge = { ...map, terrain: [...map.terrain] };
    offEdge.terrain[0] = 'grass';
    expect(checkFairness(offEdge, 3)).toContain('外周が海ではない');
  });

  it('初期位置は互いに離れている', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = createGame(`far-${seed}`, 5);
      const { width, terrain, starts } = state.map;
      const from = walk(terrain, width, starts[0].y * width + starts[0].x);
      for (const other of starts.slice(1)) expect(from[other.y * width + other.x]).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('霧', () => {
  it('霧はプレイヤーごとに別々で、未探索マスの地形は渡さない', () => {
    const state = createGame('fog', 3);
    const a = getPlayerView(state, 0);
    const b = getPlayerView(state, 1);
    expect(a.cells.map((c) => c.fog)).not.toEqual(b.cells.map((c) => c.fog));
    for (const cell of a.cells) {
      if (cell.fog === 'unknown') {
        expect(cell.terrain).toBeNull();
        expect(cell.figures).toEqual([]);
        expect(cell.depletion).toBeNull();
      }
    }
    expect(JSON.stringify(a)).not.toContain('"seed"');
  });

  it('視界半径は 基本1、山+2（夜+1）、砂浜+1、森-1', () => {
    const radius = (terrain: TerrainId, night = false) => {
      let state = sandbox(terrain);
      if (night) state = applyAction(state, { type: 'endTurn' }).state;
      return getPlayerView(state, ME).me.visionRadius;
    };
    expect(radius('grass')).toBe(1);
    expect(radius('beach')).toBe(2);
    expect(radius('forest')).toBe(0);
    expect(radius('mountain')).toBe(3);
    expect(radius('mountain', true)).toBe(2);
    expect(radius('grass', true)).toBe(1);
  });

  it('離れたマスは既知（グレー）になり、地形だけ残って人や枯渇度は見えない', () => {
    const state = sandbox('grass');
    const me = state.players[ME];
    const rival = state.players[1];
    const spot = { x: me.x + 2, y: me.y };
    rival.x = spot.x;
    rival.y = spot.y;
    me.memory[cellIndex(state, spot.x, spot.y)] = 'grass';
    state.depletion[cellIndex(state, spot.x, spot.y)] = 2;
    const cell = getPlayerView(state, ME).cells[cellIndex(state, spot.x, spot.y)];
    expect(cell).toMatchObject({ fog: 'known', terrain: 'grass', depletion: null, figures: [] });
  });

  it('記憶の地形は実際の地形が変わっても古いまま残る', () => {
    const state = sandbox('grass');
    const me = state.players[ME];
    const index = cellIndex(state, me.x + 3, me.y);
    me.memory[index] = 'forest';
    state.map.terrain[index] = 'beach';
    expect(getPlayerView(state, ME).cells[index].terrain).toBe('forest');
  });

  it('視界内の相手は昼なら誰か分かり、夜は人影になる', () => {
    let state = sandbox('grass');
    const me = state.players[ME];
    state.players[1].x = me.x;
    state.players[1].y = me.y;
    const figures = () => getPlayerView(state, ME).cells[cellIndex(state, me.x, me.y)].figures;
    expect(figures()).toContainEqual({ kind: 'player', id: 1, name: 'P2' });
    state = applyAction(state, { type: 'endTurn' }).state;
    expect(figures()).toContainEqual({ kind: 'shadow' });
    expect(JSON.stringify(figures())).not.toContain('P2');
  });
});

describe('移動', () => {
  function withNeighbor(terrain: TerrainId, direction: Direction = 'right') {
    const state = sandbox('grass');
    const me = state.players[ME];
    const dx = direction === 'right' ? 1 : direction === 'left' ? -1 : 0;
    const dy = direction === 'down' ? 1 : direction === 'up' ? -1 : 0;
    state.map.terrain[cellIndex(state, me.x + dx, me.y + dy)] = terrain;
    me.ap = AP_PER_TURN;
    return state;
  }

  it.each([
    ['beach', 1],
    ['grass', 1],
    ['forest', 2],
    ['rock', 2],
    ['mountain', 3],
    ['spring', 1],
    ['river', 1],
    ['wreck', 1],
    ['cave', 2],
    ['ruins', 2],
  ] as [TerrainId, number][])('%s の移動コストは %i', (terrain, cost) => {
    const state = withNeighbor(terrain);
    const { state: next } = applyAction(state, { type: 'move', playerId: ME, direction: 'right' });
    expect(next.players[ME].ap).toBe(AP_PER_TURN - cost);
    expect(next.players[ME].x).toBe(state.players[ME].x + 1);
  });

  it('海には入れず、APも減らない', () => {
    const state = withNeighbor('sea');
    const { state: next, events } = applyAction(state, { type: 'move', playerId: ME, direction: 'right' });
    expect(next.players[ME].x).toBe(state.players[ME].x);
    expect(next.players[ME].ap).toBe(AP_PER_TURN);
    expect(events[0]).toMatchObject({ type: 'blocked', reason: 'sea' });
  });

  it('APが足りないと動けず、霧の中なら地形だけ分かる', () => {
    const state = withNeighbor('mountain');
    const me = state.players[ME];
    me.ap = 2;
    const index = cellIndex(state, me.x + 1, me.y);
    me.memory[index] = null;
    const { state: next, events } = applyAction(state, { type: 'move', playerId: ME, direction: 'right' });
    expect(next.players[ME].x).toBe(me.x);
    expect(next.players[ME].ap).toBe(2);
    expect(next.players[ME].memory[index]).toBe('mountain');
    expect(events[0]).toMatchObject({ type: 'blocked', reason: 'noAp', cost: 3 });
  });

  it('移動すると周りの霧が晴れ、元の場所は既知として残る', () => {
    const state = withNeighbor('grass');
    const me = state.players[ME];
    const before = cellIndex(state, me.x, me.y);
    const { state: next } = applyAction(state, { type: 'move', playerId: ME, direction: 'right' });
    expect(next.players[ME].memory[cellIndex(state, me.x + 2, me.y)]).not.toBeNull();
    expect(next.players[ME].memory[before]).not.toBeNull();
  });

  it('元の状態を変更しない', () => {
    const state = withNeighbor('grass');
    const snapshot = JSON.stringify(state);
    applyAction(state, { type: 'move', playerId: ME, direction: 'right' });
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('ターン終了でAPが戻り、昼夜が入れ替わる', () => {
    const state = sandbox('grass');
    state.players[ME].ap = 0;
    const night = applyAction(state, { type: 'endTurn' });
    expect(night.state.players[ME].ap).toBe(AP_PER_TURN);
    expect(night.events[0]).toMatchObject({ turn: 2, day: 1, phase: 'night' });
    const day2 = applyAction(night.state, { type: 'endTurn' });
    expect(day2.events[0]).toMatchObject({ turn: 3, day: 2, phase: 'day' });
  });
});

describe('採取', () => {
  it('全地形の採取テーブルは合計100%', () => {
    for (const def of Object.values(TERRAIN)) {
      if (def.gather.length === 0) continue;
      expect(def.gather.reduce((sum, e) => sum + e.weight, 0)).toBe(100);
    }
  });

  it('APを1使い、APがないと採取できない', () => {
    const state = sandbox('forest');
    state.players[ME].ap = 1;
    const once = applyAction(state, { type: 'gather', playerId: ME });
    expect(once.state.players[ME].ap).toBe(0);
    const again = applyAction(once.state, { type: 'gather', playerId: ME });
    expect(again.events[0]).toMatchObject({ type: 'blocked', reason: 'noAp' });
  });

  it('同じシードと同じ行動列なら完全に同じ結果になる', () => {
    const script: Action[] = [
      { type: 'gather', playerId: 0 },
      { type: 'gather', playerId: 1 },
      { type: 'endTurn' },
      { type: 'gather', playerId: 0 },
      { type: 'gather', playerId: 2 },
      { type: 'endTurn' },
      { type: 'gather', playerId: 1 },
    ];
    const play = () => {
      let state = createGame('replay', 3);
      const log: GameEvent[] = [];
      for (const action of script) {
        const result = applyAction(state, action);
        state = result.state;
        log.push(...result.events);
      }
      return { state, log };
    };
    expect(play()).toEqual(play());
  });

  it('天井：「何もなし」が2回続いたら次は必ず手に入る', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = sandbox('mountain');
      state.rngState = seed;
      state.players[ME].dryStreak = 2;
      const { state: next, events } = applyAction(state, { type: 'gather', playerId: ME });
      expect(events[0]).toMatchObject({ type: 'gathered', pity: true });
      expect(next.players[ME].dryStreak).toBe(0);
    }
  });

  it('釣り道具がないと魚は取れず、持っていれば取れる', () => {
    const count = (withTool: boolean) => {
      let fish = 0;
      let missing = 0;
      for (let seed = 0; seed < 1000; seed++) {
        const state = sandbox('beach');
        state.rngState = seed * 7919;
        if (withTool) state.players[ME].inventory.push({ item: 'fishing_line', count: 1 });
        const { state: next, events } = applyAction(state, { type: 'gather', playerId: ME });
        if (next.players[ME].inventory.some((s) => s.item === 'fish')) fish++;
        if (events[0].type === 'gatherNothing' && events[0].missingTool) missing++;
      }
      return { fish, missing };
    };
    expect(count(false)).toMatchObject({ fish: 0 });
    expect(count(false).missing).toBeGreaterThan(100);
    expect(count(true).fish).toBeGreaterThan(100);
    expect(count(true).missing).toBe(0);
  });

  it('確率はおおむねテーブルどおり（森）', () => {
    let nothing = 0;
    let danger = 0;
    const trials = 5000;
    for (let seed = 0; seed < trials; seed++) {
      const state = sandbox('forest');
      state.rngState = Math.imul(seed, 2654435761);
      const event = applyAction(state, { type: 'gather', playerId: ME }).events[0];
      if (event.type === 'gatherNothing') nothing++;
      if (event.type === 'gatherDanger') danger++;
    }
    expect(nothing / trials).toBeGreaterThan(0.17);
    expect(nothing / trials).toBeLessThan(0.23);
    expect(danger / trials).toBeLessThan(0.04);
  });

  it('枯渇：同じマスを採取すると成功率が下がり、時間で回復する', () => {
    const table = TERRAIN.forest.gather;
    const nothingIndex = table.findIndex((e) => e.kind === 'nothing');
    const fresh = adjustedWeights(table, 0, 'day');
    const worn = adjustedWeights(table, 2, 'day');
    expect(fresh[nothingIndex]).toBe(20);
    expect(worn[nothingIndex]).toBeGreaterThan(fresh[nothingIndex]);
    expect(worn.reduce((a, b) => a + b, 0)).toBeCloseTo(100);

    let { state } = gatherMany(sandbox('forest'), 2);
    const index = cellIndex(state, state.players[ME].x, state.players[ME].y);
    expect(state.depletion[index]).toBe(2);
    for (let i = 0; i < 4; i++) state = applyAction(state, { type: 'endTurn' }).state;
    expect(state.depletion[index]).toBe(0);
  });

  it('夜は採取が不利になる', () => {
    const table = TERRAIN.grass.gather;
    const nothingIndex = table.findIndex((e) => e.kind === 'nothing');
    expect(adjustedWeights(table, 0, 'night')[nothingIndex]).toBeGreaterThan(adjustedWeights(table, 0, 'day')[nothingIndex]);
  });

  it('泉：水筒がなければその場で飲み、あれば持ち運べる。枯渇しない', () => {
    const { state: withoutCanteen, events } = gatherMany(sandbox('spring'), 5);
    expect(events.every((e) => e.type === 'drank')).toBe(true);
    expect(withoutCanteen.players[ME].inventory).toEqual([]);

    const state = sandbox('spring');
    state.players[ME].inventory.push({ item: 'canteen', count: 1 });
    const next = applyAction(state, { type: 'gather', playerId: ME }).state;
    expect(next.players[ME].inventory).toContainEqual({ item: 'water', count: 1 });
  });

  it('川では釣り道具があれば淡水に加えて魚が取れることがある', () => {
    let fish = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const state = sandbox('river');
      state.rngState = Math.imul(seed, 2654435761);
      state.players[ME].inventory.push({ item: 'fishing_rod', count: 1 });
      const next = applyAction(state, { type: 'gather', playerId: ME }).state;
      if (next.players[ME].inventory.some((s) => s.item === 'fish')) fish++;
    }
    expect(fish / 1000).toBeGreaterThan(0.15);
    expect(fish / 1000).toBeLessThan(0.25);
  });

  it('特殊マス：初回はレア確定で、2回目以降は約70%が何もなし。天井は効かない', () => {
    const first = applyAction(sandbox('cave'), { type: 'gather', playerId: ME });
    expect(first.events[0].type).toBe('gathered');

    let nothing = 0;
    for (let seed = 0; seed < 2000; seed++) {
      const state = sandbox('ruins');
      const me = state.players[ME];
      state.looted[cellIndex(state, me.x, me.y)] = true;
      state.rngState = Math.imul(seed, 2654435761);
      me.dryStreak = 2;
      const event = applyAction(state, { type: 'gather', playerId: ME }).events[0];
      if (event.type === 'gatherNothing') nothing++;
    }
    expect(nothing / 2000).toBeGreaterThan(0.66);
    expect(nothing / 2000).toBeLessThan(0.74);
  });

  it('所持枠：6枠・1枠5個まで。あふれた分は失われ、捨てれば空く', () => {
    const state = sandbox('forest');
    const me = state.players[ME];
    me.inventory = Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'stone' as const, count: STACK_SIZE }));
    state.rngState = 0;
    let current = state;
    let lost = 0;
    for (let i = 0; i < 50; i++) {
      const result = applyAction(current, { type: 'gather', playerId: ME });
      current = result.state;
      for (const event of result.events) if (event.type === 'gathered') lost += event.lost.length;
      if (!current.players[ME].alive) break;
    }
    expect(current.players[ME].inventory.length).toBe(INVENTORY_SLOTS);
    expect(lost).toBeGreaterThan(0);

    const dropped = applyAction(state, { type: 'discard', playerId: ME, item: 'stone' }).state;
    expect(dropped.players[ME].inventory[0].count).toBe(STACK_SIZE - 1);
    const missing = applyAction(state, { type: 'discard', playerId: ME, item: 'honey' });
    expect(missing.events[0]).toMatchObject({ type: 'blocked', reason: 'notOwned' });
  });

  it('危険でHPが0になると脱落し、行動できなくなる', () => {
    let state = sandbox('forest');
    state.players[ME].hp = 1;
    let eliminated = false;
    for (let seed = 0; seed < 2000 && !eliminated; seed++) {
      state.rngState = Math.imul(seed, 2654435761);
      const result = applyAction(state, { type: 'gather', playerId: ME });
      if (result.events[0].type === 'gatherDanger') {
        eliminated = true;
        state = result.state;
      }
    }
    expect(eliminated).toBe(true);
    expect(state.players[ME].alive).toBe(false);
    expect(applyAction(state, { type: 'gather', playerId: ME }).events[0]).toMatchObject({ reason: 'eliminated' });
  });
});
