import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  FATIGUE,
  getPlayerView,
  INVENTORY_SLOTS,
  projectPlan,
  resolveTurn,
  WEAPONS,
  BOTTLE,
  type Action,
  type GameEvent,
  type GameState,
  type ItemId,
} from './index';
import { cellIndex } from './testing';

const base = JSON.stringify(createGame('wounds', 3, { seats: 2, mapSize: 'large' }));

/** 全面が草原の島に2人を gap マス離して置く。5ターン目（昼） */
function arena(gap = 0): GameState {
  const state: GameState = JSON.parse(base);
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

type AttackEvent = Extract<GameEvent, { type: 'attackResult' }>;

/** 乱数を変えて何度も攻撃し、結果を集める */
function attacks(prepare: () => GameState, action: Partial<Extract<Action, { type: 'attack' }>> = {}, trials = 3000) {
  const results: { event: AttackEvent; state: GameState }[] = [];
  const start = prepare();
  for (let seed = 0; seed < trials; seed++) {
    start.rngState = Math.imul(seed + 1, 2654435761);
    const { events, state } = applyAction(start, { type: 'attack', playerId: 0, targetId: 1, ...action });
    const event = events.find((e) => e.type === 'attackResult');
    if (event?.type === 'attackResult') results.push({ event, state });
  }
  return results;
}

const withItem = (item: ItemId, gap = 0) => () => {
  const state = arena(gap);
  state.players[0].inventory = [{ item, count: 1 }];
  return state;
};

const bleedRate = (results: { event: AttackEvent }[]) => {
  const hits = results.filter((r) => r.event.hit);
  return hits.filter((r) => r.event.bleeding).length / hits.length;
};

describe('所持枠', () => {
  it('初期は8枠', () => {
    expect(INVENTORY_SLOTS).toBe(8);
  });
});

describe('出血', () => {
  it('刃物は命中すれば必ず出血させる', () => {
    expect(WEAPONS.stone_knife!.bleed).toBe(1);
    expect(WEAPONS.stone_axe!.bleed).toBe(1);
    expect(bleedRate(attacks(withItem('stone_knife')))).toBe(1);
    expect(bleedRate(attacks(withItem('stone_axe')))).toBe(1);
  });

  it('武器ごとに確率が違い、素手と投石では出血しない', () => {
    expect(bleedRate(attacks(withItem('spear', 1)))).toBeCloseTo(0.5, 1);
    expect(bleedRate(attacks(withItem('bow', 2)))).toBeCloseTo(0.5, 1);
    expect(bleedRate(attacks(() => arena(0)))).toBe(0);
    expect(bleedRate(attacks(withItem('stone', 2), { throwStone: true }))).toBe(0);
  });

  it('外れたときとダメージ0のときは出血しない', () => {
    const missed = attacks(withItem('stone_knife')).filter((r) => !r.event.hit);
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.every((r) => !r.event.bleeding && !r.state.players[1].bleeding)).toBe(true);

    const guarded = attacks(() => {
      const state = withItem('stone_knife')();
      state.players[1].guardTurn = state.turn;
      return state;
    }).filter((r) => r.event.hit);
    expect(guarded.some((r) => r.event.damage === 0)).toBe(true);
    for (const { event } of guarded) expect(event.bleeding).toBe(event.damage > 0);
  });

  /** 乱数を変えて出血を最後まで進め、何回ダメージを受けたかを数える */
  const bleedLengths = (trials = 4000) => {
    const start = arena(5);
    start.players[1].bleeding = true;
    return Array.from({ length: trials }, (_, seed) => {
      let state: GameState = JSON.parse(JSON.stringify(start));
      state.rngState = Math.imul(seed + 1, 2654435761);
      let turns = 0;
      while (state.players[1].bleeding && turns < 20) {
        state = applyAction(state, { type: 'endTurn' }).state;
        turns += 1;
      }
      return { turns, hp: state.players[1].hp };
    });
  };

  it('1ターン目のダメージは必ず受ける', () => {
    expect(bleedLengths().every((r) => r.turns >= 1 && r.hp <= 9)).toBe(true);
  });

  it('最大4ターンで必ず止まり、ターン数の分だけHPが減る', () => {
    const lengths = bleedLengths();
    expect(Math.max(...lengths.map((r) => r.turns))).toBe(4);
    for (const { turns, hp } of lengths) expect(hp).toBe(10 - turns);
  });

  it('続く確率は回を重ねるほど下がる', () => {
    const lengths = bleedLengths();
    const atLeast = (n: number) => lengths.filter((r) => r.turns >= n).length;
    const continued = (n: number) => atLeast(n + 1) / atLeast(n);
    expect(continued(1)).toBeCloseTo(0.6, 1);
    expect(continued(2)).toBeCloseTo(0.3, 1);
    expect(continued(3)).toBeCloseTo(0.15, 1);
    expect(continued(4)).toBe(0);
  });

  it('自然に止まると本人に知らせが届き、また出血すると数え直す', () => {
    const start = arena(5);
    start.players[1].bleeding = true;
    start.players[1].bleedTicks = 3;
    const { state, events } = applyAction(start, { type: 'endTurn' });
    expect(events).toContainEqual({ type: 'bleedStopped', playerId: 1 });
    expect(state.players[1]).toMatchObject({ bleeding: false, bleedTicks: 0 });
  });

  it('包帯で使うとその場で止まる', () => {
    const state = arena(5);
    state.players[1].bleeding = true;
    state.players[1].hp = 7;
    state.players[1].inventory = [{ item: 'bandage', count: 1 }];
    const { state: treated, events } = applyAction(state, { type: 'use', playerId: 1, item: 'bandage' });
    expect(treated.players[1]).toMatchObject({ bleeding: false, hp: 9 });
    expect(events[0]).toMatchObject({ type: 'used', stoppedBleeding: true });
    expect(applyAction(treated, { type: 'endTurn' }).state.players[1].hp).toBe(9);
  });

  it('出血中に包帯を作ると自動で使い、そうでなければ持っておく', () => {
    const bleeding = arena(5);
    bleeding.players[0].bleeding = true;
    bleeding.players[0].hp = 7;
    bleeding.players[0].inventory = [{ item: 'grass', count: 2 }];
    const { state, events } = applyAction(bleeding, { type: 'craft', playerId: 0, recipe: 'bandage' });
    expect(events.map((e) => e.type).slice(0, 2)).toEqual(['crafted', 'used']);
    expect(state.players[0]).toMatchObject({ bleeding: false, hp: 9, inventory: [] });

    const healthy = arena(5);
    healthy.players[0].inventory = [{ item: 'grass', count: 2 }];
    const kept = applyAction(healthy, { type: 'craft', playerId: 0, recipe: 'bandage' }).state;
    expect(kept.players[0].inventory).toEqual([{ item: 'bandage', count: 1 }]);
  });

  it('出血で倒れると脱落する', () => {
    const state = arena(5);
    state.players[1].bleeding = true;
    state.players[1].hp = 1;
    const { state: next, steps } = resolveTurn(state, {});
    expect(steps.flatMap((s) => s.events)).toContainEqual({ type: 'playerEliminated', playerId: 1 });
    expect(next.winnerId).toBe(0);
  });

  it('本人の見え方に出血が出る', () => {
    const state = arena(5);
    state.players[0].bleeding = true;
    expect(getPlayerView(state, 0).me.bleeding).toBe(true);
    expect(getPlayerView(state, 1).me.bleeding).toBe(false);
  });
});

describe('瓶', () => {
  it('当たっても外れても割れてなくなる', () => {
    const results = attacks(withItem('bottle'), { useBottle: true });
    expect(results.some((r) => r.event.hit) && results.some((r) => !r.event.hit)).toBe(true);
    for (const { event, state } of results) {
      expect(event.bottleBroke).toBe(true);
      expect(state.players[0].inventory).toEqual([]);
    }
  });

  it('命中率70%でダメージ2、出血は約50%', () => {
    const results = attacks(withItem('bottle'), { useBottle: true });
    expect(results.filter((r) => r.event.hit).length / results.length).toBeCloseTo(BOTTLE.hit, 1);
    expect(results.filter((r) => r.event.hit).every((r) => r.event.damage === 2)).toBe(true);
    expect(bleedRate(results)).toBeCloseTo(0.5, 1);
  });

  it('選ばなければ使わない', () => {
    const results = attacks(withItem('bottle'));
    expect(results.every((r) => !r.event.bottleBroke)).toBe(true);
    expect(results.every((r) => r.state.players[0].inventory.length === 1)).toBe(true);
    expect(results.filter((r) => r.event.hit).every((r) => r.event.damage === 1)).toBe(true);
  });

  it('隣の相手には踏み込んで殴れる。届かなければ不発で瓶は残る', () => {
    const near = attacks(withItem('bottle', 1), { useBottle: true }, 1)[0];
    expect(near.event.bottleBroke).toBe(true);

    const far = withItem('bottle', 9)();
    const { events, state } = applyAction(far, { type: 'attack', playerId: 0, targetId: 1, useBottle: true });
    expect(events[0].type).toBe('attackFizzled');
    expect(state.players[0].inventory).toEqual([{ item: 'bottle', count: 1 }]);
  });

  it('持っていないと不発で、予約もできない', () => {
    const state = arena(0);
    expect(applyAction(state, { type: 'attack', playerId: 0, targetId: 1, useBottle: true }).events[0].type).toBe('attackFizzled');
    const { x, y } = state.players[1];
    const view = getPlayerView(state, 0);
    expect(projectPlan(view, [{ type: 'attack', x, y, who: 1, useBottle: true }]).ok).toBe(false);
    state.players[0].inventory = [{ item: 'bottle', count: 1 }];
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'attack', x, y, who: 1, useBottle: true }]).ok).toBe(true);
  });
});

describe('疲労', () => {
  const rate = (action: Action, prepare: (state: GameState) => void = () => {}) => {
    let tired = 0;
    const trials = 4000;
    const start = arena(5);
    prepare(start);
    for (let seed = 0; seed < trials; seed++) {
      start.rngState = Math.imul(seed + 1, 2654435761);
      if (applyAction(start, action).state.players[0].fatiguedNext) tired++;
    }
    return tired / trials;
  };

  it('行動の種類ごとに確率が違う', () => {
    expect(rate({ type: 'move', playerId: 0, direction: 'up' })).toBeCloseTo(FATIGUE.movePerAp, 1);
    expect(rate({ type: 'gather', playerId: 0 })).toBeCloseTo(FATIGUE.gather, 1);
    expect(rate({ type: 'craft', playerId: 0, recipe: 'bandage' }, (s) => {
      s.players[0].inventory = [{ item: 'grass', count: 2 }];
    })).toBeCloseTo(FATIGUE.craft, 1);
    expect(rate({ type: 'craft', playerId: 0, recipe: 'trap' }, (s) => {
      s.players[0].inventory = [{ item: 'wood', count: 2 }, { item: 'grass', count: 1 }];
    })).toBeCloseTo(FATIGUE.build, 1);
    expect(rate({ type: 'attack', playerId: 0, targetId: 1 }, (s) => {
      s.players[1].x = s.players[0].x;
    })).toBeCloseTo(FATIGUE.attack, 1);
  });

  it('コストの高い地形への移動ほど疲れやすい', () => {
    const climb = rate({ type: 'move', playerId: 0, direction: 'up' }, (s) => {
      s.map.terrain[cellIndex(s, s.players[0].x, s.players[0].y - 1)] = 'mountain';
    });
    expect(climb).toBeCloseTo(FATIGUE.movePerAp * 3, 1);
  });

  it('休息、防御、隠れる、食事では疲れない', () => {
    expect(rate({ type: 'rest', playerId: 0 })).toBe(0);
    expect(rate({ type: 'guard', playerId: 0 })).toBe(0);
    expect(rate({ type: 'use', playerId: 0, item: 'fruit' }, (s) => {
      s.players[0].inventory = [{ item: 'fruit', count: 1 }];
    })).toBe(0);
  });

  it('失敗してAPを使わなかった行動では疲れない', () => {
    expect(rate({ type: 'craft', playerId: 0, recipe: 'hut' })).toBe(0);
  });

  it('疲れると次のターンだけAPが1減り、その次で戻る', () => {
    const state = arena(5);
    state.players[0].fatiguedNext = true;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.players[0]).toMatchObject({ ap: 2, tired: true, fatiguedNext: false });
    expect(getPlayerView(next, 0).me.tired).toBe(true);
    const after = applyAction(next, { type: 'endTurn' }).state;
    expect(after.players[0]).toMatchObject({ ap: 3, tired: false });
  });

  it('弱っていて疲れているとAPは1になる', () => {
    const state = arena(5);
    state.players[0].fatiguedNext = true;
    state.players[0].hunger = 3;
    state.players[0].water = 3;
    expect(applyAction(state, { type: 'endTurn' }).state.players[0].ap).toBe(1);
  });

  it('休息すると疲れを持ち越さない', () => {
    const state = arena(5);
    state.players[0].fatiguedNext = true;
    const rested = applyAction(state, { type: 'rest', playerId: 0 }).state;
    expect(rested.players[0].fatiguedNext).toBe(false);
  });

  it('同じシードなら疲労も同じ結果になる', () => {
    const play = () => {
      let state = createGame('fatigue-replay', 3);
      for (let i = 0; i < 8; i++) {
        state = resolveTurn(state, { 0: [{ type: 'gather' }, { type: 'gather' }], 1: [{ type: 'gather' }] }).state;
      }
      return state;
    };
    expect(play()).toEqual(play());
  });
});
