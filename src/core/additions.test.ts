// テストプレイの提案から追加したルールと特性
import { describe, expect, it } from 'vitest';
import { CATCH_UP_CHANCE } from '../test-setup';
import {
  applyAction,
  CATCH_UP,
  createDraft,
  createGame,
  draftAuto,
  exploreTarget,
  finishDraft,
  getPlayerView,
  MAP_CONFIG,
  projectPlan,
  proposeAlliance,
  proposeTrade,
  replayFor,
  respondAlliance,
  respondTrade,
  resolveTurn,
  senseBetrayal,
  type GameEvent,
  type GameState,
  type ItemId,
} from './index';
import { cellIndex } from './testing';

const base = JSON.stringify(createGame('additions', 3, { seats: 3, mapSize: 'large', world: true }));

function arena(gap = 1): GameState {
  const state: GameState = JSON.parse(base);
  state.npcs = [];
  for (let y = 1; y < state.map.height - 1; y++) {
    for (let x = 1; x < state.map.width - 1; x++) state.map.terrain[cellIndex(state, x, y)] = 'grass';
  }
  const center = Math.floor(state.map.width / 2);
  state.players.forEach((player, i) => {
    player.x = center + i * gap;
    player.y = center;
    player.memory.fill(null);
  });
  state.turn = 6;
  state.initiative = state.players.map((p, i) => ({ playerId: p.id, value: 10 - i, agility: 2 }));
  return state;
}
const give = (state: GameState, id: number, item: ItemId, count = 1) => state.players[id].inventory.push({ item, count });
const all = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);
/** 0番と1番が密談している計画フェーズ */
function talking(): GameState {
  const state = arena();
  state.whispers = [{ id: 0, from: 0, to: 1, status: 'open', messages: [] }];
  return state;
}

describe('6人', () => {
  it('6人の島が作れて、全員が別の場所から始まる', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const state = createGame(`six-${size}`, 6, size);
      expect(MAP_CONFIG[6][size]).toBeTruthy();
      expect(new Set(state.players.map((p) => `${p.x},${p.y}`)).size).toBe(6);
    }
  });

  it('キャラ選択で6人が6つの職業を分け合う', () => {
    let draft = createDraft('six-draft', 6, 6);
    for (let i = 0; i < 60 && draft.phase !== 'done'; i++) draft = draftAuto(draft);
    expect(new Set(finishDraft(draft).map((s) => s.job)).size).toBe(6);
  });
});

describe('数値の調整', () => {
  it('探検家の踏破率は広い島ほど低い', () => {
    const small = createGame('ratio', 4, 'small');
    const large = createGame('ratio', 4, 'large');
    const land = (s: GameState) => s.map.terrain.filter((t) => t !== 'sea').length;
    expect(exploreTarget(small) / land(small)).toBeCloseTo(0.25, 1);
    expect(exploreTarget(large) / land(large)).toBeCloseTo(0.15, 1);
  });

  it('医師は隣のマスの相手も治療できる', () => {
    const state = arena();
    state.players[0].job = 'doctor';
    state.players[1].hp = 4;
    const r = applyAction(state, { type: 'heal', playerId: 0, targetId: 1 });
    expect(r.state.players[1].hp).toBe(7);
    const far = arena(2);
    far.players[0].job = 'doctor';
    expect(applyAction(far, { type: 'heal', playerId: 0, targetId: 1 }).events[0]).toMatchObject({ targetId: null });
  });

  it('大食いは食べたときの回復が1多い', () => {
    const state = arena();
    state.players[0].hunger = 3;
    state.players[0].publicTrait = 'big_eater';
    give(state, 0, 'fruit');
    expect(applyAction(state, { type: 'use', playerId: 0, item: 'fruit' }).state.players[0].hunger).toBe(6);
  });
});

describe('賞金首', () => {
  it('勝利目前になると、その人がいるあたり3×3を全員に知らせる', () => {
    const state = arena(4);
    state.players[0].job = 'soldier';
    state.players[0].progress.warPoints = 5;
    const { state: next, steps } = resolveTurn(state, {});
    const posted = all(steps).find((e) => e.type === 'bountyPosted');
    expect(posted).toBeTruthy();
    const mark = getPlayerView(next, 2).marks.find((m) => m.kind === 'bounty')!;
    expect(Math.abs(mark.x - next.players[0].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(mark.y - next.players[0].y)).toBeLessThanOrEqual(1);
    expect(all(replayFor(2, state, steps)).some((e) => e.type === 'bountyPosted')).toBe(true);
    // 次の計画が終われば消える
    const later = resolveTurn(next, {}).state;
    expect(getPlayerView(later, 2).marks.some((m) => m.kind === 'bounty')).toBe(false);
  });

  it('偽の知らせでも賞金首の場所が出る（本物と見分けがつかない）', () => {
    const state = arena();
    state.players[0].secretTrait = 'false_alarm';
    const r = applyAction(state, { type: 'falseAlarm', playerId: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['nearVictory', 'bountyPosted']);
  });

  it('賞金稼ぎは勝利目前の人を倒すと持ち物をすべて受け取る', () => {
    const state = arena(0);
    state.players[0].secretTrait = 'bounty_hunter';
    state.players[0].inventory = [{ item: 'survival_knife', count: 1 }];
    state.players[1].hp = 1;
    state.players[1].inventory = [{ item: 'rope', count: 2 }, { item: 'fruit', count: 1 }];
    state.nearNotified = [1];
    for (let seed = 1; seed < 50; seed++) {
      state.rngState = seed * 7919;
      const r = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
      if (!r.state.players[1].alive) {
        expect(r.events.some((e) => e.type === 'bountyClaimed')).toBe(true);
        expect(r.state.players[0].inventory.map((s) => s.item)).toEqual(expect.arrayContaining(['rope', 'fruit']));
        return;
      }
    }
    throw new Error('倒せませんでした');
  });
});

describe('焚き火', () => {
  it('木材2で建てられ、煙は全員に見え、そこで食べると回復が増え、4ターンで消える', () => {
    const state = arena(6);
    give(state, 0, 'wood', 2);
    const built = applyAction(state, { type: 'craft', playerId: 0, recipe: 'campfire' }).state;
    const me = built.players[0];
    expect(built.structures[cellIndex(built, me.x, me.y)]).toMatchObject({ kind: 'campfire' });
    expect(getPlayerView(built, 2).marks.some((m) => m.kind === 'campfire')).toBe(true);
    me.hunger = 3;
    give(built, 0, 'fruit');
    expect(applyAction(built, { type: 'use', playerId: 0, item: 'fruit' }).state.players[0].hunger).toBe(6);
    let later = built;
    for (let i = 0; i < 5; i++) later = applyAction(later, { type: 'endTurn' }).state;
    expect(later.structures[cellIndex(later, me.x, me.y)]).toBeUndefined();
  });

  it('火起こし名人は木材が1少なく済む', () => {
    const state = arena();
    state.players[0].publicTrait = 'fire_maker';
    give(state, 0, 'wood', 1);
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'campfire' }).events[0].type).toBe('crafted');
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'craft', recipe: 'campfire' }]).ok).toBe(true);
  });
});

describe('取引', () => {
  it('合意すると、行動順が先の人の手番で同時に交換する', () => {
    let state = talking();
    give(state, 0, 'rope', 2);
    give(state, 1, 'fruit', 1);
    state = proposeTrade(state, 0, 0, { item: 'rope', count: 1 }, { item: 'fruit', count: 1 })!;
    expect(getPlayerView(state, 1).whispers[0].trade).toMatchObject({ mine: false, give: { item: 'fruit' }, take: { item: 'rope' }, status: 'proposed' });
    state = respondTrade(state, 1, state.trades[0].id, true)!;
    const { state: next, steps } = resolveTurn(state, {});
    expect(next.players[0].inventory).toEqual(expect.arrayContaining([{ item: 'fruit', count: 1 }]));
    expect(next.players[1].inventory).toEqual(expect.arrayContaining([{ item: 'rope', count: 1 }]));
    expect(all(replayFor(1, state, steps)).find((e) => e.type === 'traded')).toMatchObject({ betrayed: false });
    expect(next.trades).toEqual([]);
  });

  it('渡さない予約をすると、相手だけが渡すことになる（裏切り）', () => {
    let state = talking();
    give(state, 0, 'rope', 1);
    give(state, 1, 'fruit', 1);
    state = proposeTrade(state, 0, 0, { item: 'rope', count: 1 }, { item: 'fruit', count: 1 })!;
    state = respondTrade(state, 1, state.trades[0].id, true)!;
    const tradeId = state.trades[0].id;
    expect(projectPlan(getPlayerView(state, 1), [{ type: 'withhold', tradeId }]).ok).toBe(true);
    const { state: next, steps } = resolveTurn(state, { 1: [{ type: 'withhold', tradeId }] });
    expect(next.players[1].inventory).toEqual(expect.arrayContaining([{ item: 'rope', count: 1 }, { item: 'fruit', count: 1 }]));
    expect(next.players[0].inventory).toEqual([]);
    expect(all(replayFor(0, state, steps)).find((e) => e.type === 'traded')).toMatchObject({ betrayed: true, got: null });
  });

  it('持っていない物は渡せず、離れてしまったら交換しない', () => {
    const state = talking();
    expect(proposeTrade(state, 0, 0, { item: 'rope', count: 1 }, { item: 'fruit', count: 1 })).toBeNull();
    give(state, 0, 'rope', 1);
    give(state, 1, 'fruit', 1);
    let agreed = proposeTrade(state, 0, 0, { item: 'rope', count: 1 }, { item: 'fruit', count: 1 })!;
    agreed = respondTrade(agreed, 1, agreed.trades[0].id, true)!;
    agreed.players[1].x += 3;
    const next = resolveTurn(agreed, {}).state;
    expect(next.players[0].inventory).toEqual([{ item: 'rope', count: 1 }]);
  });
});

describe('同盟', () => {
  it('成立すると全員に知らされ、相手の居場所が霧の中でも見える', () => {
    let state = talking();
    state = proposeAlliance(state, 0, 0)!;
    expect(getPlayerView(state, 1).whispers[0].alliance).toBe('offeredToMe');
    const result = respondAlliance(state, 1, 0, true)!;
    expect(result.events).toEqual([{ type: 'allianceFormed', a: 0, b: 1 }]);
    state = result.state;
    state.players[1].x += 6;
    const view = getPlayerView(state, 0);
    expect(view.roster.find((p) => p.id === 1)!.ally).toBe(true);
    expect(view.cells.some((c) => c.figures.some((f) => f.kind === 'player' && f.id === 1))).toBe(true);
    expect(getPlayerView(state, 2).alliances).toEqual([{ a: 0, b: 1 }]);
  });

  it('同盟の相手を攻撃すると同盟は終わり、全員に裏切りが知らされる', () => {
    let state = talking();
    state = respondAlliance(proposeAlliance(state, 0, 0)!, 1, 0, true)!.state;
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'attack', x: state.players[1].x, y: state.players[1].y, who: 1 }] });
    expect(next.alliances).toEqual([]);
    expect(all(replayFor(2, state, steps))).toContainEqual({ type: 'allianceBroken', betrayerId: 0, victimId: 1 });
  });

  it('同盟は1人1つまで', () => {
    let state = talking();
    state = respondAlliance(proposeAlliance(state, 0, 0)!, 1, 0, true)!.state;
    state.whispers.push({ id: 1, from: 2, to: 0, status: 'open', messages: [] });
    expect(proposeAlliance(state, 2, 1)).toBeNull();
  });
});

describe('新しい特性', () => {
  it('見張り番は夜でも隣の人影が誰か分かる', () => {
    const state = arena();
    state.turn = 8;
    state.players[0].publicTrait = 'sentinel';
    const figures = getPlayerView(state, 0).cells.flatMap((c) => c.figures).filter((f) => f.kind !== 'self');
    expect(figures.some((f) => f.kind === 'player' && f.id === 1)).toBe(true);
  });

  it('逃げ足は攻撃を受けて生き残ると1マス離れる（1日1回）', () => {
    for (let seed = 1; seed < 50; seed++) {
      const state = arena(0);
      state.players[1].publicTrait = 'quick_escape';
      state.rngState = seed * 7919;
      const r = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
      const hit = r.events.find((e) => e.type === 'attackResult' && e.hit);
      if (!hit || !r.state.players[1].alive) continue;
      expect(r.events.some((e) => e.type === 'escaped')).toBe(true);
      expect(r.state.players[1].x !== state.players[1].x || r.state.players[1].y !== state.players[1].y).toBe(true);
      return;
    }
    throw new Error('当たりませんでした');
  });

  it('弓の名手は弓で3マス先まで届く', () => {
    const state = arena(3);
    state.turn = 5; // 弓は昼だけ
    state.players[0].inventory = [{ item: 'bow', count: 1 }];
    state.players[0].ap = 1;
    expect(applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0].type).toBe('attackFizzled');
    state.players[0].publicTrait = 'archer';
    expect(applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0].type).toBe('attackResult');
  });

  it('サバイバーは飢えの最初のターンを耐える', () => {
    const state = arena();
    state.players[0].secretTrait = 'survivor';
    state.players[0].hunger = 0;
    const once = applyAction(state, { type: 'endTurn' }).state;
    expect(once.players[0].hp).toBe(10);
    const twice = applyAction(once, { type: 'endTurn' }).state;
    expect(twice.players[0].hp).toBe(9);
  });

  it('裏切りの勘：密談した相手が自分への攻撃を予約すると1回だけ知らせる', () => {
    const state = talking();
    state.players[1].secretTrait = 'betrayal_sense';
    const plan = [{ type: 'attack' as const, x: state.players[1].x, y: state.players[1].y, who: 1 }];
    const first = senseBetrayal(state, 0, plan);
    expect(first.notices).toEqual([{ to: 1, event: { type: 'betrayalSensed', playerId: 1, fromId: 0 } }]);
    expect(senseBetrayal(first.state, 0, plan).notices).toEqual([]);
    expect(senseBetrayal(arena(), 0, plan).notices).toEqual([]);
  });
});

describe('最下位の救済', () => {
  it('朝、一番苦しい人の持ち物に何かが流れ着く', () => {
    CATCH_UP.chance = 1;
    try {
      const state = arena(4);
      state.turn = 6;
      state.players[2].hp = 2;
      state.players[2].inventory = [];
      const r = applyAction(state, { type: 'endTurn' });
      const found = r.events.find((e) => e.type === 'driftFound');
      expect(found).toMatchObject({ playerId: 2 });
      expect(CATCH_UP.items).toContain(r.state.players[2].inventory[0].item);
    } finally {
      CATCH_UP.chance = CATCH_UP_CHANCE;
    }
  });
});
