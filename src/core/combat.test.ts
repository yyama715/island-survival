import { describe, expect, it } from 'vitest';
import {
  applyAction,
  ATTACK_AP,
  createGame,
  getPlayerView,
  INVENTORY_SLOTS,
  projectPlan,
  replayFor,
  resolveTurn,
  STACK_SIZE,
  type GameEvent,
  type GameState,
  type PlanAction,
  type TerrainId,
} from './index';
import { cellIndex } from './testing';

/** 中央に2人を並べた、全面が草原の島。5ターン目（昼）から始める */
const baseGames = new Map<number, string>();

function arena(gap = 1, seats = 2): GameState {
  if (!baseGames.has(seats)) {
    baseGames.set(seats, JSON.stringify(createGame('combat', 3, { seats, mapSize: 'large' })));
  }
  const state: GameState = JSON.parse(baseGames.get(seats)!);
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

function setTerrain(state: GameState, x: number, y: number, terrain: TerrainId) {
  state.map.terrain[cellIndex(state, x, y)] = terrain;
}

/** 攻撃が命中するまで乱数を変えて試す */
function firstResult(prepare: () => GameState, want: (e: Extract<GameEvent, { type: 'attackResult' }>) => boolean) {
  for (let seed = 0; seed < 5000; seed++) {
    const state = prepare();
    state.rngState = Math.imul(seed, 2654435761);
    const result = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    const event = result.events.find((e) => e.type === 'attackResult');
    if (event && event.type === 'attackResult' && want(event)) return { ...result, event };
  }
  throw new Error('条件に合う結果が出ませんでした');
}

const hit = (e: { hit: boolean }) => e.hit;

describe('攻撃のコスト', () => {
  it('攻撃はAP1で、同じターンに2回はできない', () => {
    expect(ATTACK_AP).toBe(1);
    const state = arena(0);
    const once = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(once.state.players[0].ap).toBe(2);
    const twice = applyAction(once.state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(twice.events[0]).toMatchObject({ type: 'blocked', reason: 'alreadyAttacked' });
    expect(twice.state.players[0].ap).toBe(2);
  });

  it('最初の2日間は攻撃できず、APも減らない', () => {
    const state = arena(0);
    state.turn = 4;
    const result = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(result.events[0]).toMatchObject({ type: 'blocked', reason: 'protected' });
    expect(result.state.players[0].ap).toBe(3);
  });
});

describe('追跡攻撃', () => {
  it('同じマスならその場で攻撃する', () => {
    const { events, state } = applyAction(arena(0), { type: 'attack', playerId: 0, targetId: 1 });
    expect(events.map((e) => e.type)).toEqual(['attackResult']);
    expect(state.players[0].ap).toBe(2);
  });

  it('隣にいれば踏み込んで攻撃する。森でも入れる（2+1=3AP）', () => {
    const prepare = () => {
      const state = arena(1);
      setTerrain(state, state.players[1].x, state.players[1].y, 'forest');
      return state;
    };
    const { events, state } = applyAction(prepare(), { type: 'attack', playerId: 0, targetId: 1 });
    expect(events[0]).toMatchObject({ type: 'moved', cost: 2 });
    expect(events[1].type).toBe('attackResult');
    expect(state.players[0]).toMatchObject({ x: state.players[1].x, ap: 0 });
  });

  it('斜めの相手にも届く（1+1+1=3AP）', () => {
    const state = arena(1);
    state.players[1].y += 1;
    const { events, state: next } = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(events.filter((e) => e.type === 'moved')).toHaveLength(2);
    expect(events.at(-1)!.type).toBe('attackResult');
    expect(next.players[0].ap).toBe(0);
  });

  it('山には外から入って殴れず、不発になってAPを1失う', () => {
    const state = arena(1);
    setTerrain(state, state.players[1].x, state.players[1].y, 'mountain');
    const { events, state: next } = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(events).toEqual([{ type: 'attackFizzled', playerId: 0 }]);
    expect(next.players[0]).toMatchObject({ x: state.players[0].x, ap: 2 });
  });

  it('山を避ける遠回りでも届くなら、安いほうの道を通る', () => {
    const state = arena(2);
    const me = state.players[0];
    setTerrain(state, me.x + 1, me.y, 'mountain');
    state.players[1].x = me.x + 1;
    state.players[1].y = me.y + 1;
    const { events } = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
    expect(events.filter((e) => e.type === 'moved').map((e) => e.type === 'moved' && [e.x, e.y])).toEqual([
      [me.x, me.y + 1],
      [me.x + 1, me.y + 1],
    ]);
  });

  it('海は越えられない', () => {
    const state = arena(2);
    setTerrain(state, state.players[0].x + 1, state.players[0].y, 'sea');
    setTerrain(state, state.players[0].x, state.players[0].y + 1, 'sea');
    setTerrain(state, state.players[0].x, state.players[0].y - 1, 'sea');
    setTerrain(state, state.players[0].x - 1, state.players[0].y, 'sea');
    expect(applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0].type).toBe('attackFizzled');
  });

  it('後手でも、先に動いた相手を追いかけて攻撃できる', () => {
    const state = arena(1);
    setOrder(state, 1, 0);
    const me = state.players[0];
    const plan = (x: number, y: number) => ({
      0: [{ type: 'attack', x, y, who: 1 }] as PlanAction[],
      1: [{ type: 'move', direction: 'right' }] as PlanAction[],
    });
    const { steps } = resolveTurn(state, plan(me.x + 1, me.y));
    const events = steps.flatMap((s) => s.events);
    expect(events.filter((e) => e.type === 'moved' && e.playerId === 0)).toHaveLength(2);
    expect(events.some((e) => e.type === 'attackResult')).toBe(true);
  });

  it('遠くまで逃げられたら不発で、その場に残る', () => {
    const state = arena(1);
    setOrder(state, 1, 0);
    const me = state.players[0];
    const right: PlanAction = { type: 'move', direction: 'right' };
    const { state: next, steps } = resolveTurn(state, {
      0: [{ type: 'attack', x: me.x + 1, y: me.y, who: 1 }],
      1: [right, right, right],
    });
    expect(steps.flatMap((s) => s.events)).toContainEqual({ type: 'attackFizzled', playerId: 0 });
    expect(next.players[0].x).toBe(me.x);
  });

  it('追いかけて場所が変わったら、残りの予約は取り消す', () => {
    const state = arena(1);
    const me = state.players[0];
    const { steps } = resolveTurn(state, {
      0: [{ type: 'attack', x: me.x + 1, y: me.y, who: 1 }, { type: 'gather' }],
    });
    expect(steps.flatMap((s) => s.events)).toContainEqual({ type: 'planCancelled', playerId: 0, count: 1 });
  });
});

function setOrder(state: GameState, ...ids: number[]) {
  state.initiative = ids.map((playerId, i) => ({ playerId, value: 10 - i, agility: 2 }));
}

describe('命中とダメージ', () => {
  const rate = (prepare: () => GameState) => {
    let hits = 0;
    const trials = 4000;
    for (let seed = 0; seed < trials; seed++) {
      const state = prepare();
      state.rngState = Math.imul(seed, 2654435761);
      const event = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events.find((e) => e.type === 'attackResult');
      if (event?.type === 'attackResult' && event.hit) hits++;
    }
    return hits / trials;
  };

  it('素手の命中率は70%で、夜は80%', () => {
    expect(rate(() => arena(0))).toBeCloseTo(0.7, 1);
    expect(
      rate(() => {
        const state = arena(0);
        state.turn = 6;
        return state;
      }),
    ).toBeCloseTo(0.8, 1);
  });

  it('素手のダメージは1で、岩場でも最低1', () => {
    expect(firstResult(() => arena(0), hit).event.damage).toBe(1);
    const onRock = () => {
      const state = arena(0);
      setTerrain(state, state.players[1].x, state.players[1].y, 'rock');
      return state;
    };
    expect(firstResult(onRock, hit).event.damage).toBe(1);
  });

  it('一番強い武器を自動で使う。石斧は 1d3＋2', () => {
    const damages = new Set<number>();
    for (let seed = 0; seed < 300; seed++) {
      const state = arena(0);
      state.players[0].inventory = [{ item: 'stone_knife', count: 1 }, { item: 'stone_axe', count: 1 }];
      state.rngState = Math.imul(seed, 2654435761);
      const event = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0];
      if (event.type === 'attackResult' && event.hit) damages.add(event.damage);
    }
    expect([...damages].sort()).toEqual([3, 4, 5]);
  });

  it('槍は隣から動かずに攻撃でき、斜めは命中率−15%でダメージ−1', () => {
    const adjacent = () => {
      const state = arena(1);
      state.players[0].inventory = [{ item: 'spear', count: 1 }];
      return state;
    };
    const straight = applyAction(adjacent(), { type: 'attack', playerId: 0, targetId: 1 });
    expect(straight.events.map((e) => e.type)).toEqual(['attackResult']);
    expect(straight.state.players[0].ap).toBe(2);
    expect(rate(adjacent)).toBeCloseTo(0.6, 1);

    const diagonal = () => {
      const state = adjacent();
      state.players[1].y += 1;
      return state;
    };
    expect(rate(diagonal)).toBeCloseTo(0.45, 1);
    const damage = firstResult(diagonal, hit).event.damage;
    expect(damage).toBeGreaterThanOrEqual(2);
    expect(damage).toBeLessThanOrEqual(4);
  });

  it('反撃は約30%で起き、攻撃した側が1ダメージ受ける', () => {
    const { event, state } = firstResult(() => arena(0), (e) => e.hit && e.counter > 0);
    expect(event.counter).toBe(1);
    expect(state.players[0].hp).toBe(9);
    let counters = 0;
    let hits = 0;
    for (let seed = 0; seed < 3000; seed++) {
      const s = arena(0);
      s.rngState = Math.imul(seed, 2654435761);
      const e = applyAction(s, { type: 'attack', playerId: 0, targetId: 1 }).events[0];
      if (e.type === 'attackResult' && e.hit) {
        hits++;
        if (e.counter > 0) counters++;
      }
    }
    expect(counters / hits).toBeCloseTo(0.3, 1);
  });

  it('命中すると所持品を1個奪う。武器は奪えない', () => {
    const prepare = () => {
      const state = arena(0);
      state.players[1].inventory = [{ item: 'stone', count: 2 }, { item: 'spear', count: 1 }];
      return state;
    };
    const { event, state } = firstResult(prepare, hit);
    expect(event.stolen).toEqual({ item: 'stone', count: 1 });
    expect(state.players[0].inventory).toEqual([{ item: 'stone', count: 1 }]);
    expect(state.players[1].inventory).toEqual([{ item: 'stone', count: 1 }, { item: 'spear', count: 1 }]);
  });

  it('持ちきれないときは奪えない', () => {
    const prepare = () => {
      const state = arena(0);
      state.players[0].inventory = Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'ore' as const, count: STACK_SIZE }));
      state.players[1].inventory = [{ item: 'stone', count: 1 }];
      return state;
    };
    const { event, state } = firstResult(prepare, hit);
    expect(event.stolen).toBeNull();
    expect(state.players[1].inventory).toHaveLength(1);
  });

  it('先手から2以上のダメージを受けると、これから手番の人はAPが減る', () => {
    const axe = (first: boolean) => () => {
      const state = arena(0);
      state.players[0].inventory = [{ item: 'stone_axe', count: 1 }];
      setOrder(state, ...(first ? [0, 1] : [1, 0]));
      return state;
    };
    expect(firstResult(axe(true), hit).state.players[1].ap).toBe(2);
    expect(firstResult(axe(false), hit).state.players[1].ap).toBe(3);
  });
});

describe('脱落と遺品', () => {
  const lethal = () => {
    const state = arena(0);
    state.players[1].hp = 1;
    state.players[1].inventory = [{ item: 'stone', count: 2 }, { item: 'wood', count: 1 }];
    return state;
  };

  it('HP0で脱落し、とどめを刺した人が遺品を拾う', () => {
    const { state, events } = firstResult(lethal, hit);
    expect(state.players[1]).toMatchObject({ alive: false, hp: 0, inventory: [] });
    expect(events.some((e) => e.type === 'relicTaken')).toBe(true);
    const total = state.players[0].inventory.reduce((n, s) => n + s.count, 0);
    expect(total).toBe(3);
    expect(state.relics).toEqual({});
  });

  it('持ちきれない遺品はマスに残り、後から来た人が拾える', () => {
    const { state } = firstResult(() => {
      const s = lethal();
      s.players[0].inventory = Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'ore' as const, count: STACK_SIZE }));
      return s;
    }, hit);
    const index = cellIndex(state, state.players[1].x, state.players[1].y);
    expect(state.relics[index]).toBeDefined();
    expect(getPlayerView(state, 0).cells[index].relic).toBe(true);
  });

  it('移動して遺品のマスに入ると拾う', () => {
    const state = arena(1);
    const index = cellIndex(state, state.players[0].x + 1, state.players[0].y);
    state.relics[index] = [{ item: 'flint', count: 1 }];
    const { state: next, events } = applyAction(state, { type: 'move', playerId: 0, direction: 'right' });
    expect(next.players[0].inventory).toEqual([{ item: 'flint', count: 1 }]);
    expect(next.relics[index]).toBeUndefined();
    expect(events.at(-1)).toEqual({ type: 'relicTaken', playerId: 0, items: [{ item: 'flint', count: 1 }] });
  });

  it('解決フェーズで脱落が公開され、最後の1人が勝つ', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = lethal();
      state.rngState = Math.imul(seed, 2654435761);
      const { state: next, steps } = resolveTurn(state, {
        0: [{ type: 'attack', x: state.players[1].x, y: state.players[1].y, who: 1 }],
      });
      if (!next.players[1].alive) {
        const events = steps.flatMap((s) => s.events);
        expect(events).toContainEqual({ type: 'playerEliminated', playerId: 1 });
        expect(next).toMatchObject({ finished: true, winnerId: 0 });
        return;
      }
    }
    throw new Error('脱落しませんでした');
  });

  it('脱落した人の予約は実行されない', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = lethal();
      setOrder(state, 0, 1);
      state.rngState = Math.imul(seed, 2654435761);
      const { state: next, steps } = resolveTurn(state, {
        0: [{ type: 'attack', x: state.players[1].x, y: state.players[1].y, who: 1 }],
        1: [{ type: 'gather' }],
      });
      if (!next.players[1].alive) {
        expect(steps.some((s) => s.actorId === 1)).toBe(false);
        return;
      }
    }
    throw new Error('脱落しませんでした');
  });
});

describe('攻撃の予約', () => {
  it('昼は見えている本人を指定できる', () => {
    const state = arena(1);
    const view = getPlayerView(state, 0);
    const { x, y } = state.players[1];
    expect(projectPlan(view, [{ type: 'attack', x, y, who: 1 }])).toMatchObject({ ok: true, ap: 2 });
  });

  it('見えていない相手、自分、2回目、最初の2日間は予約できない', () => {
    const state = arena(5);
    const view = getPlayerView(state, 0);
    const far = state.players[1];
    expect(projectPlan(view, [{ type: 'attack', x: far.x, y: far.y, who: 1 }]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'attack', x: far.x, y: far.y }]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'attack', x: -1, y: 99, who: 1 }]).ok).toBe(false);

    const near = arena(0);
    const nearView = getPlayerView(near, 0);
    const me = near.players[0];
    expect(projectPlan(nearView, [{ type: 'attack', x: me.x, y: me.y, who: 0 }]).ok).toBe(false);
    const one: PlanAction = { type: 'attack', x: me.x, y: me.y, who: 1 };
    expect(projectPlan(nearView, [one]).ok).toBe(true);
    expect(projectPlan(nearView, [one, one]).ok).toBe(false);

    near.turn = 4;
    expect(projectPlan(getPlayerView(near, 0), [one]).ok).toBe(false);
  });

  it('夜は人影のいるマスを指定する。名前での指定はできない', () => {
    const state = arena(0);
    state.turn = 6;
    const view = getPlayerView(state, 0);
    const { x, y } = state.players[1];
    expect(projectPlan(view, [{ type: 'attack', x, y }]).ok).toBe(true);
    expect(projectPlan(view, [{ type: 'attack', x, y, who: 1 }]).ok).toBe(false);
    const { steps } = resolveTurn(state, { 0: [{ type: 'attack', x, y }] });
    expect(steps.flatMap((s) => s.events).some((e) => e.type === 'attackResult')).toBe(true);
  });
});

describe('戦闘の見え方', () => {
  function fight(turn: number) {
    for (let seed = 0; seed < 200; seed++) {
      const state = arena(0, 3);
      state.turn = turn;
      state.rngState = Math.imul(seed, 2654435761);
      state.players[1].inventory = [{ item: 'stone', count: 1 }];
      const { x, y } = state.players[1];
      state.players[2].x = x + 1;
      state.players[2].y = y;
      const action: PlanAction = turn % 2 === 1 ? { type: 'attack', x, y, who: 1 } : { type: 'attack', x, y };
      const { steps } = resolveTurn(state, { 0: [action] });
      const result = steps.flatMap((s) => s.events).find((e) => e.type === 'attackResult');
      if (result?.type === 'attackResult' && result.hit && result.targetId === 1) {
        return { state, steps };
      }
    }
    throw new Error('命中しませんでした');
  }
  const events = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);

  it('当事者には結果が届き、遠くの人には戦闘があったことも届かない', () => {
    const { state, steps } = fight(5);
    state.players[2].x += 5;
    const replay = (id: number) => events(replayFor(id, state, steps));
    expect(replay(1).find((e) => e.type === 'attackResult')).toMatchObject({ attackerId: 0, targetId: 1, hit: true });
    const adjusted = steps.map((s) => {
      const after: GameState = JSON.parse(JSON.stringify(s.state));
      after.players[2].x = state.players[2].x;
      return { ...s, state: after };
    });
    const far = events(replayFor(2, state, adjusted)).map((e) => e.type);
    expect(far).not.toContain('attackResult');
    expect(far).not.toContain('combatSeen');
  });

  it('見ていた第三者には戦闘が見えるが、ダメージや奪った物は分からない', () => {
    const { state, steps } = fight(5);
    const seen = events(replayFor(2, state, steps));
    expect(seen.find((e) => e.type === 'combatSeen')).toMatchObject({ attackerId: 0, targetId: 1 });
    expect(seen.some((e) => e.type === 'attackResult')).toBe(false);
    expect(JSON.stringify(seen)).not.toContain('stolen');
  });

  it('夜は誰に襲われたのか分からない', () => {
    const { state, steps } = fight(7 + 1);
    const victim = events(replayFor(1, state, steps)).find((e) => e.type === 'attackResult');
    expect(victim).toMatchObject({ attackerId: null, targetId: 1 });
    const attacker = events(replayFor(0, state, steps)).find((e) => e.type === 'attackResult');
    expect(attacker).toMatchObject({ attackerId: 0, targetId: null });
    const third = events(replayFor(2, state, steps)).find((e) => e.type === 'combatSeen');
    expect(third).toMatchObject({ attackerId: null, targetId: null });
  });
});

describe('森の視線', () => {
  /** 主人公を砂浜（視界2）に置く */
  function onBeach() {
    const state = arena(9);
    const me = state.players[0];
    setTerrain(state, me.x, me.y, 'beach');
    return state;
  }
  const fogAt = (state: GameState, x: number, y: number) => getPlayerView(state, 0).cells[cellIndex(state, x, y)].fog;

  it('視界の中でも、森の奥は見えない。手前の森は見える', () => {
    const state = onBeach();
    const me = state.players[0];
    setTerrain(state, me.x + 1, me.y, 'forest');
    setTerrain(state, me.x + 2, me.y, 'forest');
    expect(fogAt(state, me.x + 1, me.y)).toBe('visible');
    expect(fogAt(state, me.x + 2, me.y)).toBe('unknown');
    expect(getPlayerView(state, 0).cells[cellIndex(state, me.x + 2, me.y)].terrain).toBeNull();
  });

  it('森の奥にいる人は見えない', () => {
    const state = onBeach();
    const me = state.players[0];
    setTerrain(state, me.x + 1, me.y, 'forest');
    state.players[1].x = me.x + 2;
    state.players[1].y = me.y;
    const figures = getPlayerView(state, 0).cells.flatMap((c) => c.figures);
    expect(figures.every((f) => f.kind === 'self')).toBe(true);
  });

  it('草原の向こうはこれまでどおり見える', () => {
    const state = onBeach();
    const me = state.players[0];
    setTerrain(state, me.x + 2, me.y, 'forest');
    expect(fogAt(state, me.x + 1, me.y)).toBe('visible');
    expect(fogAt(state, me.x + 2, me.y)).toBe('visible');
  });

  it('斜めの森も奥を隠す', () => {
    const state = onBeach();
    const me = state.players[0];
    setTerrain(state, me.x + 1, me.y + 1, 'forest');
    expect(fogAt(state, me.x + 1, me.y + 1)).toBe('visible');
    expect(fogAt(state, me.x + 2, me.y + 2)).toBe('unknown');
  });

  it('線が境目を通るときは、両側が森のときだけ隠れる', () => {
    const one = onBeach();
    const a = one.players[0];
    setTerrain(one, a.x + 1, a.y, 'forest');
    expect(fogAt(one, a.x + 2, a.y + 1)).toBe('visible');

    const both = onBeach();
    const b = both.players[0];
    setTerrain(both, b.x + 1, b.y, 'forest');
    setTerrain(both, b.x + 1, b.y + 1, 'forest');
    expect(fogAt(both, b.x + 2, b.y + 1)).toBe('unknown');
  });

  it('山からは森の向こうまで見渡せる', () => {
    const state = arena(9);
    const me = state.players[0];
    setTerrain(state, me.x, me.y, 'mountain');
    setTerrain(state, me.x + 1, me.y, 'forest');
    setTerrain(state, me.x + 2, me.y, 'forest');
    expect(fogAt(state, me.x + 3, me.y)).toBe('visible');
  });

  it('森の中からは自分のマスだけが見える', () => {
    const state = arena(9);
    const me = state.players[0];
    setTerrain(state, me.x, me.y, 'forest');
    expect(fogAt(state, me.x, me.y)).toBe('visible');
    expect(fogAt(state, me.x + 1, me.y)).toBe('unknown');
  });

  it('移動して視界が変わると、隠れていた奥が見えるようになる', () => {
    const state = onBeach();
    const me = state.players[0];
    setTerrain(state, me.x + 1, me.y, 'grass');
    setTerrain(state, me.x + 2, me.y, 'forest');
    setTerrain(state, me.x + 3, me.y, 'grass');
    expect(fogAt(state, me.x + 3, me.y)).toBe('unknown');
    const next = applyAction(state, { type: 'move', playerId: 0, direction: 'right' }).state;
    // 草原の視界は1なので、森のマスまで
    expect(fogAt(next, me.x + 2, me.y)).toBe('visible');
    expect(fogAt(next, me.x + 3, me.y)).toBe('unknown');
  });
});
