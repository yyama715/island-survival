import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getPlayerView,
  projectPlan,
  RECIPES,
  replayFor,
  respondWhisper,
  resolveTurn,
  sendWhisper,
  type GameEvent,
  type GameState,
  type ItemId,
  type PlanAction,
  type RecipeId,
  type TerrainId,
} from './index';
import { cellIndex } from './testing';

const base = new Map<number, string>();
/** 素材3種類と合わせて所持枠を埋める物 */
const fillers: { item: ItemId; count: number }[] = (
  ['fruit', 'ore', 'water', 'flint', 'cloth'] as ItemId[]
).map((item) => ({ item, count: 1 }));

/** 全面が草原の島に、2人を gap マス離して置く。5ターン目（昼）から始める */
function arena(gap = 5, seats = 2): GameState {
  if (!base.has(seats)) base.set(seats, JSON.stringify(createGame('survive', 3, { seats, mapSize: 'large' })));
  const state: GameState = JSON.parse(base.get(seats)!);
  for (let y = 1; y < state.map.height - 1; y++) {
    for (let x = 1; x < state.map.width - 1; x++) state.map.terrain[cellIndex(state, x, y)] = 'grass';
  }
  const center = Math.floor(state.map.width / 2);
  state.players.forEach((player, i) => {
    player.x = center + i * gap;
    player.y = center;
    player.memory.fill(null);
  });
  state.turn = 5;
  state.initiative = state.players.map((p, i) => ({ playerId: p.id, value: 10 - i, agility: 2 }));
  return state;
}

const setHere = (state: GameState, id: number, terrain: TerrainId) => {
  const p = state.players[id];
  state.map.terrain[cellIndex(state, p.x, p.y)] = terrain;
};
const give = (state: GameState, id: number, item: ItemId, count = 1) => state.players[id].inventory.push({ item, count });
const act = (state: GameState, action: Parameters<typeof applyAction>[1]) => applyAction(state, action);
const events = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);

describe('満腹度と水分', () => {
  it('初期値は8で、昼ターンの始まりにだけ1ずつ減る', () => {
    const state = createGame('tick', 3);
    expect(state.players[0]).toMatchObject({ hunger: 8, water: 8 });
    const night = applyAction(state, { type: 'endTurn' }).state; // 2ターン目（夜）
    expect(night.players[0]).toMatchObject({ hunger: 8, water: 8 });
    const day = applyAction(night, { type: 'endTurn' }).state; // 3ターン目（昼）
    expect(day.players[0]).toMatchObject({ hunger: 7, water: 7 });
  });

  it('満腹度が0だと毎ターンHP−1、水分が0だと毎ターンHP−2（夜も）', () => {
    const state = arena();
    state.turn = 6; // 次は7ターン目（昼）
    state.players[0].hunger = 1;
    const day = applyAction(state, { type: 'endTurn' });
    expect(day.state.players[0]).toMatchObject({ hunger: 0, hp: 9 });
    expect(day.events).toContainEqual({ type: 'statusDamage', playerId: 0, hunger: 1, thirst: 0, poison: 0, bleed: 0 });
    const night = applyAction(day.state, { type: 'endTurn' });
    expect(night.state.players[0].hp).toBe(8);

    const dry = arena();
    dry.players[0].water = 0;
    expect(applyAction(dry, { type: 'endTurn' }).state.players[0].hp).toBe(8);
  });

  it('どちらも3以下だとAPが1減り、片方だけなら減らない', () => {
    const state = arena();
    state.players[0].hunger = 3;
    state.players[0].water = 3;
    state.players[1].hunger = 3;
    state.players[1].water = 9;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.players[0].ap).toBe(2);
    expect(next.players[1].ap).toBe(3);
    expect(getPlayerView(next, 0).me.weak).toBe(true);
  });

  it('弱っていると行動値が2下がり、休息の次のターンは1上がる', () => {
    const average = (prepare: (s: GameState) => void) => {
      const base = arena();
      prepare(base);
      let sum = 0;
      const trials = 800;
      for (let seed = 0; seed < trials; seed++) {
        base.rngState = Math.imul(seed, 2654435761);
        const { initiative } = applyAction(base, { type: 'endTurn' }).state;
        sum += initiative.find((e) => e.playerId === 0)!.value;
      }
      return sum / trials;
    };
    const normal = average(() => {});
    const weak = average((s) => {
      s.players[0].hunger = 3;
      s.players[0].water = 3;
    });
    expect(normal - weak).toBeCloseTo(2, 0);
    const rested = average((s) => {
      s.players[0].restedTurn = s.turn;
    });
    expect(rested - normal).toBeCloseTo(1, 0);
  });

  it('飢えで倒れると脱落が公開され、最後の1人が勝つ', () => {
    const state = arena();
    state.players[1].hp = 1;
    state.players[1].water = 0;
    const { state: next, steps } = resolveTurn(state, {});
    expect(events(steps)).toContainEqual({ type: 'playerEliminated', playerId: 1 });
    expect(next).toMatchObject({ finished: true, winnerId: 0 });
  });
});

describe('食事と飲水', () => {
  it('APを使わず回復し、上限を超えない', () => {
    const state = arena();
    state.players[0].hunger = 5;
    give(state, 0, 'fruit');
    const { state: next, events: e } = act(state, { type: 'use', playerId: 0, item: 'fruit' });
    expect(next.players[0]).toMatchObject({ hunger: 7, ap: 3, inventory: [] });
    expect(e[0]).toMatchObject({ type: 'used', hunger: 2 });

    state.players[0].hunger = 10;
    expect(act(state, { type: 'use', playerId: 0, item: 'fruit' }).state.players[0].hunger).toBe(10);
  });

  it('淡水は水分を、包帯はHPを回復する', () => {
    const state = arena();
    state.players[0].water = 2;
    state.players[0].hp = 5;
    give(state, 0, 'water');
    give(state, 0, 'bandage');
    const drunk = act(state, { type: 'use', playerId: 0, item: 'water' }).state;
    expect(drunk.players[0].water).toBe(5);
    expect(act(drunk, { type: 'use', playerId: 0, item: 'bandage' }).state.players[0].hp).toBe(7);
  });

  it('貝を食べると貝殻が残る', () => {
    const state = arena();
    give(state, 0, 'shell');
    expect(act(state, { type: 'use', playerId: 0, item: 'shell' }).state.players[0].inventory).toEqual([
      { item: 'shell_husk', count: 1 },
    ]);
  });

  it('キノコは約25%で中毒になり、2ターンHPが1ずつ減る', () => {
    let poisoned = 0;
    const trials = 2000;
    for (let seed = 0; seed < trials; seed++) {
      const state = arena();
      give(state, 0, 'mushroom');
      state.rngState = Math.imul(seed, 2654435761);
      if (act(state, { type: 'use', playerId: 0, item: 'mushroom' }).state.players[0].poisonTurns > 0) poisoned++;
    }
    expect(poisoned / trials).toBeCloseTo(0.25, 1);

    let state = arena();
    state.players[0].poisonTurns = 2;
    state = applyAction(state, { type: 'endTurn' }).state;
    state = applyAction(state, { type: 'endTurn' }).state;
    expect(state.players[0].hp).toBe(8);
    state = applyAction(state, { type: 'endTurn' }).state;
    expect(state.players[0].hp).toBe(8);
  });

  it('泉で水筒がなければその場で飲んで水分が3増える', () => {
    const state = arena();
    setHere(state, 0, 'spring');
    state.players[0].water = 4;
    expect(act(state, { type: 'gather', playerId: 0 }).state.players[0].water).toBe(7);
  });

  it('使えない物と持っていない物は使えない', () => {
    const state = arena();
    give(state, 0, 'stone');
    expect(act(state, { type: 'use', playerId: 0, item: 'stone' }).events[0]).toMatchObject({ reason: 'notOwned' });
    expect(act(state, { type: 'use', playerId: 0, item: 'fruit' }).events[0]).toMatchObject({ reason: 'notOwned' });
  });
});

describe('休息', () => {
  it('残りAP1つにつきHP+1で、APは全部なくなる', () => {
    const state = arena();
    state.players[0].hp = 5;
    state.players[0].ap = 2;
    expect(act(state, { type: 'rest', playerId: 0 }).state.players[0]).toMatchObject({ hp: 7, ap: 0, restedTurn: 5 });
  });

  it('小屋の中なら倍回復し、上限を超えない', () => {
    const state = arena();
    state.players[0].hp = 5;
    state.structures[cellIndex(state, state.players[0].x, state.players[0].y)] = { kind: 'hut', ownerId: 1 };
    expect(act(state, { type: 'rest', playerId: 0 }).state.players[0].hp).toBe(10);
  });
});

describe('クラフトと建設', () => {
  it('素材を使って道具を作る。ロープは2通りの作り方がある', () => {
    const state = arena();
    give(state, 0, 'stone');
    give(state, 0, 'wood');
    const { state: next, events: e } = act(state, { type: 'craft', playerId: 0, recipe: 'stone_knife' });
    expect(next.players[0].inventory).toEqual([{ item: 'stone_knife', count: 1 }]);
    expect(next.players[0].ap).toBe(2);
    expect(e[0]).toMatchObject({ type: 'crafted', recipe: 'stone_knife' });

    const scraps = arena();
    give(scraps, 0, 'rope_scrap', 2);
    expect(act(scraps, { type: 'craft', playerId: 0, recipe: 'rope' }).state.players[0].inventory).toEqual([
      { item: 'rope', count: 1 },
    ]);
  });

  it('素材やAPが足りないと作れず、何も減らない', () => {
    const state = arena();
    give(state, 0, 'stone');
    const short = act(state, { type: 'craft', playerId: 0, recipe: 'stone_knife' });
    expect(short.events[0]).toMatchObject({ reason: 'missingMaterials' });
    expect(short.state.players[0]).toMatchObject({ ap: 3, inventory: [{ item: 'stone', count: 1 }] });

    const tired = arena();
    tired.players[0].ap = 1;
    give(tired, 0, 'stone', 2);
    give(tired, 0, 'wood');
    expect(act(tired, { type: 'craft', playerId: 0, recipe: 'stone_axe' }).events[0]).toMatchObject({ reason: 'noAp' });
  });

  it('持ちきれないときは作らず、素材もAPも減らない', () => {
    const state = arena();
    state.players[0].inventory = [
      { item: 'wood', count: 5 },
      { item: 'grass', count: 5 },
      { item: 'stone', count: 3 },
      ...fillers,
    ];
    const before = JSON.stringify(state.players[0].inventory);
    const view = getPlayerView(state, 0);
    expect(projectPlan(view, [{ type: 'craft', recipe: 'stone_knife' }]).ok).toBe(false);
    const { state: next, events: e } = act(state, { type: 'craft', playerId: 0, recipe: 'stone_knife' });
    expect(e[0]).toMatchObject({ type: 'blocked', reason: 'inventoryFull' });
    expect(JSON.stringify(next.players[0].inventory)).toBe(before);
    expect(next.players[0].ap).toBe(3);
  });

  it('素材の枠が空くなら、満杯でも作れる', () => {
    const state = arena();
    state.players[0].inventory = [
      { item: 'stone', count: 1 },
      { item: 'wood', count: 1 },
      { item: 'grass', count: 5 },
      ...fillers,
    ];
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'craft', recipe: 'stone_knife' }]).ok).toBe(true);
    expect(act(state, { type: 'craft', playerId: 0, recipe: 'stone_knife' }).events[0].type).toBe('crafted');
  });

  it('全レシピの材料があれば作れる', () => {
    for (const id of Object.keys(RECIPES) as RecipeId[]) {
      const state = arena();
      const recipe = RECIPES[id];
      state.players[0].ap = 9;
      for (const { item, count } of recipe.inputs[0]) give(state, 0, item, count);
      const { events: e } = act(state, { type: 'craft', playerId: 0, recipe: id });
      expect(e[0]).toMatchObject({ type: 'crafted', recipe: id });
    }
  });

  it('石斧で木材が倍、釣竿で魚が増える', () => {
    const woodCounts = new Set<number>();
    for (let seed = 0; seed < 500; seed++) {
      const state = arena();
      setHere(state, 0, 'forest');
      give(state, 0, 'stone_axe');
      state.rngState = Math.imul(seed, 2654435761);
      for (const event of act(state, { type: 'gather', playerId: 0 }).events) {
        if (event.type === 'gathered' && event.gained[0]?.item === 'wood') woodCounts.add(event.gained[0].count);
      }
    }
    expect([...woodCounts].sort()).toEqual([2, 4]);

    let fish = 0;
    for (let seed = 0; seed < 500 && !fish; seed++) {
      const state = arena();
      setHere(state, 0, 'beach');
      give(state, 0, 'fishing_rod');
      state.rngState = Math.imul(seed, 2654435761);
      for (const event of act(state, { type: 'gather', playerId: 0 }).events) {
        if (event.type === 'gathered' && event.gained[0]?.item === 'fish') fish = event.gained[0].count;
      }
    }
    expect(fish).toBe(2);
  });

  it('小屋はマスに建ち、同じマスに2つは建たない', () => {
    const state = arena();
    state.players[0].ap = 9;
    give(state, 0, 'wood', 5);
    give(state, 0, 'wood', 3);
    give(state, 0, 'grass', 4);
    const once = act(state, { type: 'craft', playerId: 0, recipe: 'hut' });
    const index = cellIndex(state, state.players[0].x, state.players[0].y);
    expect(once.state.structures[index]).toEqual({ kind: 'hut', ownerId: 0 });
    expect(getPlayerView(once.state, 0).cells[index].structure).toBe('hut');
    expect(act(once.state, { type: 'craft', playerId: 0, recipe: 'hut' }).events[0]).toMatchObject({ reason: 'occupied' });
  });

  it('作った物を同じ予約の中で使える', () => {
    const view = getPlayerView(
      (() => {
        const state = arena();
        give(state, 0, 'grass', 2);
        return state;
      })(),
      0,
    );
    const plan: PlanAction[] = [{ type: 'craft', recipe: 'bandage' }, { type: 'use', item: 'bandage' }];
    expect(projectPlan(view, plan)).toMatchObject({ ok: true, ap: 2 });
    expect(projectPlan(view, [{ type: 'use', item: 'bandage' }]).ok).toBe(false);
  });
});

describe('罠', () => {
  function trapped(owner = 1) {
    const state = arena(2);
    const me = state.players[0];
    state.structures[cellIndex(state, me.x + 1, me.y)] = { kind: 'trap', ownerId: owner };
    return state;
  }

  it('他人が入るとHP−2でAPがなくなり、罠は消える。持ち主には知らせが届く', () => {
    const state = trapped();
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'move', direction: 'right' }, { type: 'gather' }] });
    const all = events(steps);
    expect(all).toContainEqual({ type: 'trapTriggered', playerId: 0, damage: 2 });
    expect(all).toContainEqual({ type: 'blocked', playerId: 0, reason: 'noAp' });
    expect(next.players[0].hp).toBe(8);
    expect(Object.keys(next.structures)).toHaveLength(0);
    expect(events(replayFor(1, state, steps)).map((e) => e.type)).toContain('trapSprung');
  });

  it('置いた本人には効かず、本人にしか見えない', () => {
    const state = trapped(0);
    const next = act(state, { type: 'move', playerId: 0, direction: 'right' }).state;
    expect(next.players[0].hp).toBe(10);
    const index = cellIndex(state, state.players[0].x + 1, state.players[0].y);
    expect(next.structures[index]).toBeDefined();

    const near = trapped(0);
    near.players[1].x = near.players[0].x + 1;
    expect(getPlayerView(near, 0).cells[index].structure).toBe('trap');
    expect(getPlayerView(near, 1).cells[index].structure).toBeNull();
  });

  it('警戒していれば罠を見つけて無事に通れる（手番より前に予約が効く）', () => {
    const state = trapped();
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'guard' }, { type: 'move', direction: 'right' }] });
    expect(next.players[0].hp).toBe(10);
    expect(events(steps)).toContainEqual({ type: 'trapDisarmed', playerId: 0 });
  });

  it('序盤の保護期間でも置ける', () => {
    const state = arena();
    state.turn = 1;
    give(state, 0, 'wood', 2);
    give(state, 0, 'grass');
    const { events: e } = act(state, { type: 'craft', playerId: 0, recipe: 'trap' });
    expect(e[0].type).toBe('crafted');
  });

  it('追跡中に罠にかかると、そこで止まる', () => {
    const state = arena(2);
    const me = state.players[0];
    state.structures[cellIndex(state, me.x + 1, me.y)] = { kind: 'trap', ownerId: 1 };
    const { events: e, state: next } = act(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(e.some((x) => x.type === 'trapTriggered')).toBe(true);
    expect(e.some((x) => x.type === 'attackResult')).toBe(false);
    expect(next.players[1].hp).toBe(10);
  });
});

describe('防御・警戒', () => {
  it('命中率が20%下がり、ダメージが2減る', () => {
    const rate = (guard: boolean) => {
      let hits = 0;
      const trials = 3000;
      const base = arena(0);
      if (guard) base.players[1].guardTurn = 5;
      for (let seed = 0; seed < trials; seed++) {
        base.rngState = Math.imul(seed, 2654435761);
        const event = act(base, { type: 'attack', playerId: 0, targetId: 1 }).events[0];
        if (event.type === 'attackResult' && event.hit) hits++;
      }
      return hits / trials;
    };
    expect(rate(true)).toBeCloseTo(0.5, 1);
    expect(rate(false)).toBeCloseTo(0.7, 1);
  });

  it('後手で防御を予約していても、先手の攻撃に効く', () => {
    const damages = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      const state = arena(0);
      give(state, 0, 'stone_axe');
      state.rngState = Math.imul(seed, 2654435761);
      const { x, y } = state.players[1];
      const { steps } = resolveTurn(state, { 0: [{ type: 'attack', x, y, who: 1 }], 1: [{ type: 'guard' }] });
      const hit = events(steps).find((e) => e.type === 'attackResult');
      if (hit?.type === 'attackResult' && hit.hit) damages.add(hit.damage);
    }
    expect([...damages].sort()).toEqual([1, 2, 3]);
  });

  it('素手は防御すれば無傷になる', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = arena(0);
      state.players[1].guardTurn = 5;
      state.rngState = Math.imul(seed, 2654435761);
      const event = act(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0];
      if (event.type === 'attackResult' && event.hit) {
        expect(event.damage).toBe(0);
        return;
      }
    }
    throw new Error('命中しませんでした');
  });
});

describe('隠れる', () => {
  function hidden() {
    const state = arena(1);
    setHere(state, 1, 'forest');
    state.players[1].hidden = true;
    return state;
  }

  it('森と岩場でだけ隠れられる', () => {
    const open = arena();
    expect(act(open, { type: 'hide', playerId: 0 }).events[0]).toMatchObject({ reason: 'cannotHide' });
    const rock = arena();
    setHere(rock, 0, 'rock');
    expect(act(rock, { type: 'hide', playerId: 0 }).state.players[0]).toMatchObject({ hidden: true, ap: 2 });
    expect(projectPlan(getPlayerView(open, 0), [{ type: 'hide' }]).ok).toBe(false);
  });

  it('視界に映らず、狙えない', () => {
    const state = hidden();
    const { x, y } = state.players[1];
    const cell = getPlayerView(state, 0).cells[cellIndex(state, x, y)];
    expect(cell.figures).toEqual([]);
    expect(act(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0].type).toBe('attackFizzled');
  });

  it('移動、採取、攻撃で解除される', () => {
    expect(act(hidden(), { type: 'gather', playerId: 1 }).state.players[1].hidden).toBe(false);
    expect(act(hidden(), { type: 'move', playerId: 1, direction: 'right' }).state.players[1].hidden).toBe(false);
    const state = hidden();
    state.players[0].x = state.players[1].x;
    expect(act(state, { type: 'attack', playerId: 1, targetId: 0 }).state.players[1].hidden).toBe(false);
  });

  it('同じマスに入られると見つかる', () => {
    const state = hidden();
    const { state: next, events: e } = act(state, { type: 'move', playerId: 0, direction: 'right' });
    expect(next.players[1].hidden).toBe(false);
    expect(e).toContainEqual({ type: 'foundOut', playerId: 1 });
  });

  it('警戒すると隣のマスに隠れている人も見つける', () => {
    const state = hidden();
    const { state: next, events: e } = act(state, { type: 'guard', playerId: 0 });
    expect(next.players[1].hidden).toBe(false);
    expect(e.some((x) => x.type === 'spotted')).toBe(true);
  });
});

describe('待ち伏せ', () => {
  it('自分のマスに入ってきた相手を、行動順に関係なく攻撃する', () => {
    let result = null;
    for (let seed = 0; seed < 100; seed++) {
      const state = arena(1);
      state.initiative = [
        { playerId: 1, value: 9, agility: 2 },
        { playerId: 0, value: 3, agility: 2 },
      ];
      state.rngState = Math.imul(seed, 2654435761);
      const r = resolveTurn(state, { 0: [{ type: 'ambush' }], 1: [{ type: 'move', direction: 'left' }] });
      const hit = events(r.steps).find((e) => e.type === 'attackResult');
      if (hit?.type === 'attackResult' && hit.hit) {
        result = { hit, r };
        break;
      }
    }
    expect(result).not.toBeNull();
    expect(result!.hit).toMatchObject({ attackerId: 0, targetId: 1, ambush: true });
    const order = result!.r.steps.flatMap((s) => s.events).map((e) => e.type);
    expect(order.indexOf('attackResult')).toBeLessThan(order.lastIndexOf('actorTurn'));
  });

  it('誰も来なければ何も起きず、攻撃は1ターン1回まで', () => {
    const state = arena(3);
    const { steps } = resolveTurn(state, { 0: [{ type: 'ambush' }] });
    expect(events(steps).some((e) => e.type === 'attackResult')).toBe(false);

    const twice = arena(1, 3);
    twice.players[2].x = twice.players[0].x;
    twice.players[2].y = twice.players[0].y + 1;
    const r = resolveTurn(twice, {
      0: [{ type: 'ambush' }],
      1: [{ type: 'move', direction: 'left' }],
      2: [{ type: 'move', direction: 'up' }],
    });
    expect(events(r.steps).filter((e) => e.type === 'attackResult')).toHaveLength(1);
  });

  it('移動や攻撃とは一緒に予約できず、序盤の保護期間は使えない', () => {
    const state = arena(0);
    const view = getPlayerView(state, 0);
    const { x, y } = state.players[1];
    expect(projectPlan(view, [{ type: 'ambush' }]).ok).toBe(true);
    expect(projectPlan(view, [{ type: 'ambush' }, { type: 'move', direction: 'up' }]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'move', direction: 'up' }, { type: 'ambush' }]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'ambush' }, { type: 'attack', x, y, who: 1 }]).ok).toBe(false);
    state.turn = 4;
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'ambush' }]).ok).toBe(false);
  });
});

describe('投石と弓', () => {
  const rate = (prepare: () => GameState, throwStone: boolean) => {
    let hits = 0;
    const trials = 3000;
    const base = prepare();
    for (let seed = 0; seed < trials; seed++) {
      base.rngState = Math.imul(seed, 2654435761);
      const event = act(base, { type: 'attack', playerId: 0, targetId: 1, throwStone }).events.find((e) => e.type === 'attackResult');
      if (event?.type === 'attackResult' && event.hit) hits++;
    }
    return hits / trials;
  };

  it('投石は石を1個使い、2マス先の直線に届く。命中50%でダメージ1', () => {
    const state = arena(2);
    give(state, 0, 'stone', 2);
    let hit = null;
    for (let seed = 0; seed < 50 && !hit; seed++) {
      state.rngState = Math.imul(seed, 2654435761);
      const r = act(state, { type: 'attack', playerId: 0, targetId: 1, throwStone: true });
      const event = r.events[0];
      expect(r.state.players[0].inventory).toEqual([{ item: 'stone', count: 1 }]);
      expect(r.state.players[0].x).toBe(state.players[0].x);
      if (event.type === 'attackResult' && event.hit) hit = event;
    }
    expect(hit).toMatchObject({ damage: 1, stolen: null, counter: 0 });
    expect(rate(() => {
      const s = arena(2);
      give(s, 0, 'stone');
      return s;
    }, true)).toBeCloseTo(0.5, 1);
  });

  it('投石は直線にしか届かず、石がなければ不発。素手の追跡はしない', () => {
    const state = arena(2);
    state.players[1].y += 1; // (2,1) は直線ではない
    give(state, 0, 'stone');
    state.players[0].ap = 1; // 動けない
    expect(act(state, { type: 'attack', playerId: 0, targetId: 1, throwStone: true }).events[0].type).toBe('attackFizzled');

    const empty = arena(1);
    expect(act(empty, { type: 'attack', playerId: 0, targetId: 1, throwStone: true }).events[0].type).toBe('attackFizzled');
  });

  it('夜は投石も弓も使えない', () => {
    const state = arena(1);
    state.turn = 6;
    give(state, 0, 'stone');
    const view = getPlayerView(state, 0);
    const { x, y } = state.players[1];
    expect(projectPlan(view, [{ type: 'attack', x, y, throwStone: true }]).ok).toBe(false);

    const bow = arena(2);
    bow.turn = 6;
    bow.players[0].inventory = [{ item: 'bow', count: 1 }];
    const moved = act(bow, { type: 'attack', playerId: 0, targetId: 1 });
    expect(moved.events.some((e) => e.type === 'moved')).toBe(true); // 素手で追いかける
  });

  it('弓は2マス先から動かずに撃ち、森の相手には命中率が20%下がる', () => {
    const open = () => {
      const s = arena(2);
      s.players[0].inventory = [{ item: 'bow', count: 1 }];
      return s;
    };
    const first = act(open(), { type: 'attack', playerId: 0, targetId: 1 });
    expect(first.events.map((e) => e.type)).toEqual(['attackResult']);
    expect(rate(open, false)).toBeCloseTo(0.6, 1);
    expect(rate(() => {
      const s = open();
      setHere(s, 1, 'forest');
      return s;
    }, false)).toBeCloseTo(0.4, 1);
  });

  it('離れた所からの攻撃では略奪も反撃も起きない', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = arena(2);
      state.players[0].inventory = [{ item: 'bow', count: 1 }];
      state.players[1].inventory = [{ item: 'stone', count: 1 }];
      state.rngState = Math.imul(seed, 2654435761);
      const event = act(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0];
      if (event.type === 'attackResult') expect(event).toMatchObject({ stolen: null, counter: 0 });
    }
  });
});

describe('松明', () => {
  it('夜の視界が1広がる', () => {
    const state = arena();
    state.turn = 6;
    expect(getPlayerView(state, 0).me.visionRadius).toBe(1);
    give(state, 0, 'torch');
    expect(getPlayerView(state, 0).me.visionRadius).toBe(2);
  });

  it('持っている人は夜でも誰なのか分かる', () => {
    const state = arena(1);
    state.turn = 6;
    const cell = () => getPlayerView(state, 0).cells[cellIndex(state, state.players[1].x, state.players[1].y)];
    expect(cell().figures[0]).toEqual({ kind: 'shadow' });
    give(state, 1, 'torch');
    expect(cell().figures[0]).toMatchObject({ kind: 'player', id: 1 });
  });
});

describe('手紙', () => {
  it('木材を使って置き、そのマスに来た人だけが読める', () => {
    const state = arena(1);
    give(state, 0, 'wood');
    const { state: next, events: e } = act(state, { type: 'letter', playerId: 0, text: '  森で会おう  ' });
    expect(e[0].type).toBe('letterLeft');
    expect(next.players[0]).toMatchObject({ ap: 2, inventory: [] });
    expect(getPlayerView(next, 0).letters).toEqual(['森で会おう']);
    expect(getPlayerView(next, 1).letters).toEqual([]);
    const arrived = act(next, { type: 'move', playerId: 1, direction: 'left' }).state;
    expect(getPlayerView(arrived, 1).letters).toEqual(['森で会おう']);
  });

  it('50文字で切り、空の手紙や木材なしでは置けない', () => {
    const state = arena();
    give(state, 0, 'wood');
    const long = act(state, { type: 'letter', playerId: 0, text: 'あ'.repeat(80) }).state;
    expect(getPlayerView(long, 0).letters[0]).toHaveLength(50);
    expect(act(state, { type: 'letter', playerId: 0, text: '   ' }).events[0]).toMatchObject({ reason: 'missingMaterials' });
    expect(act(arena(), { type: 'letter', playerId: 0, text: 'x' }).events[0]).toMatchObject({ reason: 'missingMaterials' });
  });
});

describe('密談', () => {
  function asked(gap = 1) {
    const state = arena(gap, 3);
    state.turn = 6; // 解決すると昼になる
    const { x, y } = state.players[1];
    state.players[2].x = state.players[0].x;
    state.players[2].y = state.players[0].y + 1;
    return { state, x, y };
  }

  it('AP1を使い、解決の終わりに近くにいれば頼める', () => {
    const { state, x, y } = asked();
    const { state: next } = resolveTurn(state, { 0: [{ type: 'whisper', x, y, who: 1 }] });
    expect(next.whispers).toEqual([{ id: 0, from: 0, to: 1, status: 'pending', messages: [] }]);
  });

  it('相手が離れたら成立せず、本人に知らせが届く', () => {
    const { state, x, y } = asked();
    const right: PlanAction = { type: 'move', direction: 'right' };
    const { state: next, steps } = resolveTurn(state, {
      0: [{ type: 'whisper', x, y, who: 1 }],
      1: [right, right, right],
    });
    expect(next.whispers).toEqual([]);
    expect(events(replayFor(0, state, steps))).toContainEqual({ type: 'whisperFailed', playerId: 0 });
    expect(events(replayFor(1, state, steps)).map((e) => e.type)).not.toContain('whisperFailed');
  });

  it('序盤の保護期間でも使える', () => {
    const { state, x, y } = asked();
    state.turn = 1;
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'whisper', x, y, who: 1 }]).ok).toBe(true);
  });

  function opened() {
    const { state, x, y } = asked();
    const next = resolveTurn(state, { 0: [{ type: 'whisper', x, y, who: 1 }] }).state;
    return respondWhisper(next, 1, 0, true)!;
  }

  it('頼まれた本人しか返事ができず、断ると話せない', () => {
    const { state, x, y } = asked();
    const next = resolveTurn(state, { 0: [{ type: 'whisper', x, y, who: 1 }] }).state;
    expect(respondWhisper(next, 0, 0, true)).toBeNull();
    expect(respondWhisper(next, 2, 0, true)).toBeNull();
    const refused = respondWhisper(next, 1, 0, false)!;
    expect(refused.whispers[0].status).toBe('refused');
    expect(sendWhisper(refused, 0, 0, 'やあ')).toBeNull();
    expect(respondWhisper(refused, 1, 0, true)).toBeNull();
  });

  it('各3メッセージ、50文字まで。当事者だけが話せて読める', () => {
    let state = opened();
    for (const text of ['1', '2', '3']) state = sendWhisper(state, 0, 0, text)!;
    expect(sendWhisper(state, 0, 0, '4')).toBeNull();
    state = sendWhisper(state, 1, 0, 'あ'.repeat(99))!;
    expect(state.whispers[0].messages.at(-1)!.text).toHaveLength(50);
    expect(sendWhisper(state, 2, 0, '横から')).toBeNull();
    expect(sendWhisper(state, 1, 0, '   ')).toBeNull();

    const mine = getPlayerView(state, 0).whispers[0];
    expect(mine).toMatchObject({ incoming: false, status: 'open', withId: 1 });
    expect(mine.messages[0]).toEqual({ mine: true, text: '1' });
    expect(getPlayerView(state, 1).whispers[0].incoming).toBe(true);
    expect(getPlayerView(state, 2).whispers).toEqual([]);
    expect(JSON.stringify(getPlayerView(state, 2))).not.toContain('あああ');
  });

  it('2人を視界に入れている人には話していることだけが見える', () => {
    const state = opened();
    const third = getPlayerView(state, 2);
    expect(third.whisperSeen).toHaveLength(2);
    expect(getPlayerView(state, 0).whisperSeen).toEqual([]);
    const far: GameState = JSON.parse(JSON.stringify(state));
    far.players[2].x += 5;
    expect(getPlayerView(far, 2).whisperSeen).toEqual([]);
  });

  it('夜は相手が誰か分からない', () => {
    const state = opened();
    state.turn = 8;
    expect(getPlayerView(state, 0).whispers[0].withId).toBeNull();
  });

  it('次のターンの解決で密談は終わる', () => {
    expect(resolveTurn(opened(), {}).state.whispers).toEqual([]);
  });
});

describe('予約の見込み', () => {
  it('休息は残りAPを全部使い、あとにAPの要る行動は入れられない', () => {
    const view = getPlayerView(arena(), 0);
    expect(projectPlan(view, [{ type: 'gather' }, { type: 'rest' }])).toMatchObject({ ok: true, ap: 0 });
    expect(projectPlan(view, [{ type: 'rest' }, { type: 'gather' }]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'rest' }, { type: 'rest' }]).ok).toBe(false);
  });

  it('所持品の見込みを返す', () => {
    const state = arena();
    give(state, 0, 'grass', 2);
    const { owned } = projectPlan(getPlayerView(state, 0), [{ type: 'craft', recipe: 'bandage' }]);
    expect(owned).toMatchObject({ grass: 0, bandage: 1 });
  });

  it('霧の中の位置では小屋の有無や隠れられるかは判定しない', () => {
    const state = arena();
    const view = getPlayerView(state, 0);
    expect(projectPlan(view, [{ type: 'guard' }]).ok).toBe(true);
  });
});
