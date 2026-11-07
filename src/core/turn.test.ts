import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getPlayerView,
  projectPlan,
  replayFor,
  resolveTurn,
  STACK_SIZE,
  INVENTORY_SLOTS,
  type GameEvent,
  type GameState,
  type PlanAction,
  type TerrainId,
} from './index';
import { cellIndex } from './testing';

const right: PlanAction = { type: 'move', direction: 'right' };
const gather: PlanAction = { type: 'gather' };

/** 全員を島の中央付近の草原に並べる */
function arena(seats = 3): GameState {
  const state = createGame('arena', Math.max(3, seats), { seats });
  const center = Math.floor(state.map.width / 2);
  for (let y = 1; y < state.map.height - 1; y++) {
    for (let x = 1; x < state.map.width - 1; x++) state.map.terrain[cellIndex(state, x, y)] = 'grass';
  }
  state.players.forEach((player, i) => {
    player.x = center - 1;
    player.y = center - 1 + i;
  });
  return state;
}

function setOrder(state: GameState, ...ids: number[]) {
  state.initiative = ids.map((playerId, i) => ({ playerId, value: 10 - i, agility: 2 }));
}

const allEvents = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);

describe('行動順', () => {
  it('行動値は 機敏さ＋1d6 の範囲で、高い順に並ぶ', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { initiative } = createGame(`init-${seed}`, 5);
      expect(initiative).toHaveLength(5);
      for (let i = 0; i < initiative.length; i++) {
        expect(initiative[i].value).toBeGreaterThanOrEqual(3);
        expect(initiative[i].value).toBeLessThanOrEqual(8);
        if (i > 0) expect(initiative[i - 1].value).toBeGreaterThanOrEqual(initiative[i].value);
      }
    }
  });

  it('毎ターン振り直され、シードが同じなら同じになる', () => {
    const run = () => {
      let state = createGame('order', 4);
      const orders = [state.initiative];
      for (let i = 0; i < 6; i++) {
        state = resolveTurn(state, {}).state;
        orders.push(state.initiative);
      }
      return orders;
    };
    const orders = run();
    expect(orders).toEqual(run());
    expect(new Set(orders.map((o) => JSON.stringify(o))).size).toBeGreaterThan(1);
  });

  it('重傷と所持枠満杯は行動値を下げる', () => {
    const average = (prepare: (state: GameState) => void) => {
      let total = 0;
      const trials = 600;
      for (let seed = 0; seed < trials; seed++) {
        const state = createGame('mods', 3);
        state.rngState = Math.imul(seed, 2654435761);
        prepare(state);
        const next = applyAction(state, { type: 'endTurn' }).state;
        total += next.initiative.find((e) => e.playerId === 0)!.value;
      }
      return total / trials;
    };
    const normal = average(() => {});
    expect(normal - average((s) => (s.players[0].hp = 5))).toBeCloseTo(1, 0);
    const full = average((s) => {
      s.players[0].inventory = Array.from({ length: INVENTORY_SLOTS }, () => ({ item: 'stone' as const, count: STACK_SIZE }));
    });
    expect(normal - full).toBeCloseTo(1, 0);
  });

  it('脱落した人は行動順に入らない', () => {
    const state = arena();
    state.players[1].alive = false;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.initiative.map((e) => e.playerId).sort()).toEqual([0, 2]);
  });
});

describe('解決フェーズ', () => {
  it('行動順に1人ずつ、その人の予約を全部実行する', () => {
    const state = arena();
    setOrder(state, 2, 0, 1);
    const { steps } = resolveTurn(state, { 0: [right, gather], 1: [gather], 2: [right] });
    const sequence = steps.filter((s) => s.actorId !== null).map((s) => [s.actorId, s.events[0].type]);
    expect(sequence).toEqual([
      [2, 'actorTurn'],
      [2, 'moved'],
      [0, 'actorTurn'],
      [0, 'moved'],
      [0, expect.any(String)],
      [1, 'actorTurn'],
      [1, expect.any(String)],
    ]);
  });

  it('解決が終わると次のターンになり、昼夜とAPが更新される', () => {
    const state = arena();
    const { state: next, steps } = resolveTurn(state, { 0: [right] });
    expect(next.turn).toBe(2);
    expect(next.players[0].ap).toBe(3);
    expect(steps.at(-1)!.events[0]).toMatchObject({ type: 'turnStarted', turn: 2, phase: 'night' });
  });

  it('同じシードと同じ予約なら完全に同じ結果になる', () => {
    const play = () => {
      let state = createGame('same', 3);
      const log: unknown[] = [];
      for (let i = 0; i < 5; i++) {
        const result = resolveTurn(state, { 0: [gather], 1: [gather, gather], 2: [gather] });
        state = result.state;
        log.push(allEvents(result.steps));
      }
      return { state, log };
    };
    expect(play()).toEqual(play());
  });

  it('霧の中で止められたら、その人の残りの予約は実行しない', () => {
    const state = arena();
    const me = state.players[0];
    state.map.terrain[cellIndex(state, me.x + 1, me.y)] = 'sea';
    const { state: next, steps } = resolveTurn(state, { 0: [right, gather, gather] });
    expect(next.players[0].x).toBe(me.x);
    expect(allEvents(steps)).toContainEqual({ type: 'planCancelled', playerId: 0, count: 2 });
  });

  it('何も予約しなくてもターンは進む', () => {
    expect(resolveTurn(arena(), {}).state.turn).toBe(2);
  });

  it('最後の1人になると勝者が決まり、全員倒れると勝者なしで終わる', () => {
    const lastOne = arena(2);
    lastOne.players[1].alive = false;
    const won = resolveTurn(lastOne, {});
    expect(won.state).toMatchObject({ finished: true, winnerId: 0, turn: 1 });

    const none = arena(2);
    none.players.forEach((p) => (p.alive = false));
    expect(resolveTurn(none, {}).state).toMatchObject({ finished: true, winnerId: null });
  });

  it('1人で遊んでいるときは勝者が決まらず続く', () => {
    expect(resolveTurn(arena(1), {}).state.finished).toBe(false);
  });
});

describe('見え方の絞り込み', () => {
  function apart(): GameState {
    const state = arena();
    state.players[1].x = state.players[0].x + 5;
    state.players[1].y = state.players[0].y;
    state.players[2].x = state.players[0].x;
    state.players[2].y = state.players[0].y + 5;
    setOrder(state, 0, 1, 2);
    return state;
  }

  it('他の人の採取結果や所持品は渡さない', () => {
    const state = apart();
    const { steps } = resolveTurn(state, { 1: [gather, gather, gather] });
    const replay = replayFor(0, state, steps);
    const types = allEvents(replay).map((e) => e.type);
    expect(types).not.toContain('gathered');
    expect(types).not.toContain('gatherNothing');
    expect(types).toContain('actorTurn');
  });

  it('予約の数が分からないよう、手番の知らせは1人1回だけ', () => {
    const state = apart();
    const count = (plan: PlanAction[]) => {
      const { steps } = resolveTurn(state, { 1: plan });
      return replayFor(0, state, steps).length;
    };
    expect(count([gather])).toBe(count([gather, gather, gather]));
  });

  it('視界の外の移動は見えず、視界に入った移動は見える', () => {
    const state = apart();
    const far = resolveTurn(state, { 1: [right] });
    expect(allEvents(replayFor(0, state, far.steps)).map((e) => e.type)).not.toContain('sighted');

    const near = arena();
    setOrder(near, 0, 1, 2);
    near.players[1].x = near.players[0].x + 2;
    near.players[1].y = near.players[0].y;
    const left: PlanAction = { type: 'move', direction: 'left' };
    const seen = resolveTurn(near, { 1: [left] });
    expect(allEvents(replayFor(0, near, seen.steps))).toContainEqual({
      type: 'sighted',
      who: 1,
      x: near.players[0].x + 1,
      y: near.players[0].y,
    });
  });

  it('夜は誰が動いたのか分からない', () => {
    const near = applyAction(arena(), { type: 'endTurn' }).state;
    setOrder(near, 0, 1, 2);
    near.players[1].x = near.players[0].x + 2;
    near.players[1].y = near.players[0].y;
    const seen = resolveTurn(near, { 1: [{ type: 'move', direction: 'left' }] });
    const sighted = allEvents(replayFor(0, near, seen.steps)).find((e) => e.type === 'sighted');
    expect(sighted).toMatchObject({ who: null });
  });

  it('他の人の位置や地形の情報が見え方の中に漏れない', () => {
    const state = apart();
    const { steps } = resolveTurn(state, { 1: [right], 2: [right] });
    for (const step of replayFor(0, state, steps)) {
      if (!step.view) continue;
      for (const cell of step.view.cells) {
        if (cell.fog === 'unknown') expect(cell.terrain).toBeNull();
        for (const figure of cell.figures) expect(figure.kind).toBe('self');
      }
    }
  });
});

describe('予約の見込み', () => {
  function viewOn(here: TerrainId, neighbor: TerrainId | null) {
    const state = arena();
    const me = state.players[0];
    state.map.terrain[cellIndex(state, me.x, me.y)] = here;
    const index = cellIndex(state, me.x + 1, me.y);
    if (neighbor) {
      state.map.terrain[index] = neighbor;
      me.memory[index] = neighbor;
    }
    const view = getPlayerView(state, 0);
    if (!neighbor) view.cells[index].terrain = null;
    return view;
  }

  it('移動コストと採取のAPを引いた見込みを返す', () => {
    const view = viewOn('grass', 'forest');
    expect(projectPlan(view, [right, gather])).toMatchObject({ ok: true, x: view.me.x + 1, ap: 0, uncertain: false });
  });

  it('APを超える予約と、知っている海への移動は無効', () => {
    const view = viewOn('grass', 'mountain');
    expect(projectPlan(view, [right, gather]).ok).toBe(false);
    expect(projectPlan(viewOn('grass', 'sea'), [right]).ok).toBe(false);
  });

  it('霧の中はコスト1と見込み、不確かだと分かる', () => {
    expect(projectPlan(viewOn('grass', null), [right])).toMatchObject({ ok: true, ap: 2, uncertain: true });
  });

  it('持っていない物は捨てられない', () => {
    const view = viewOn('grass', 'grass');
    view.me.inventory = [{ item: 'stone', count: 1 }];
    expect(projectPlan(view, [{ type: 'discard', item: 'stone' }]).ok).toBe(true);
    expect(projectPlan(view, [{ type: 'discard', item: 'stone' }, { type: 'discard', item: 'stone' }]).ok).toBe(false);
  });

  it('脱落していると予約できない', () => {
    const view = viewOn('grass', 'grass');
    view.me.alive = false;
    expect(projectPlan(view, []).ok).toBe(false);
  });
});
