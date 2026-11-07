import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createDraft,
  createGame,
  draftAuto,
  finishDraft,
  getPlayerView,
  ghostPlanForCpu,
  planForCpu,
  projectPlan,
  replayFor,
  resolveTurn,
  Rng,
  type CpuLevel,
  type GameEvent,
  type GameState,
  type Npc,
  type PlanAction,
  type TerrainId,
} from './index';
import { cellIndex } from './testing';

const base = JSON.stringify(createGame('world', 3, { seats: 2, mapSize: 'large', world: true }));

function arena(gap = 5): GameState {
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
  state.turn = 6; // 次は朝
  state.initiative = state.players.map((p, i) => ({ playerId: p.id, value: 10 - i, agility: 2 }));
  return state;
}

const addNpc = (state: GameState, npc: Partial<Npc> & { kind: Npc['kind']; x: number; y: number }) => {
  const full: Npc = { id: state.nextNpcId++, hp: 3, ...npc };
  state.npcs.push(full);
  return full;
};
const events = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);

/** 指定の天候が出るまで乱数を変えて朝を迎える */
function dawnWith(weather: GameState['weather'], prepare: (s: GameState) => void = () => {}) {
  for (let seed = 0; seed < 300; seed++) {
    const state = arena();
    prepare(state);
    state.rngState = Math.imul(seed + 1, 2654435761);
    const result = applyAction(state, { type: 'endTurn' });
    if (result.state.weather === weather) return result;
  }
  throw new Error('天候が出ませんでした');
}

describe('天候', () => {
  it('朝に天候が変わり、全員に公開される', () => {
    const state = arena();
    const { state: next, steps } = resolveTurn(state, {});
    expect(events(steps).some((e) => e.type === 'weatherChanged')).toBe(true);
    expect(events(replayFor(1, state, steps)).some((e) => e.type === 'weatherChanged')).toBe(true);
    expect(getPlayerView(next, 0).weather).toBe(next.weather);
  });

  it('晴れは水分が余分に減る。暑さに強い人は減らない', () => {
    expect(dawnWith('sunny').state.players[0].water).toBe(6);
    expect(dawnWith('sunny', (s) => (s.players[0].publicTrait = 'heat_proof')).state.players[0].water).toBe(7);
  });

  it('雨は水分が増えて視界が狭くなり、狼煙が上げられない', () => {
    const { state } = dawnWith('rain');
    expect(state.players[0].water).toBe(9);
    expect(getPlayerView(state, 0).me.visionRadius).toBe(0);
    const p = state.players[0];
    state.map.terrain[cellIndex(state, p.x, p.y)] = 'mountain';
    p.inventory = [{ item: 'wood', count: 5 }, { item: 'flint', count: 1 }];
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'smoke' }).events[0]).toMatchObject({ reason: 'notAllowed' });
  });

  it('嵐は小屋の外でHP−2、移動コスト+1、狼煙が消える', () => {
    const outside = dawnWith('storm');
    expect(outside.state.players[0].hp).toBe(8);
    const inHut = dawnWith('storm', (s) => {
      const p = s.players[0];
      s.structures[cellIndex(s, p.x, p.y)] = { kind: 'hut', ownerId: 0 };
    });
    expect(inHut.state.players[0].hp).toBe(10);
    const moved = applyAction(outside.state, { type: 'move', playerId: 0, direction: 'up' }).state;
    expect(moved.players[0].ap).toBe(outside.state.players[0].ap - 2);
    expect(projectPlan(getPlayerView(outside.state, 0), [{ type: 'move', direction: 'up' }]).ap).toBe(outside.state.players[0].ap - 2);
    const smoke = dawnWith('storm', (s) => {
      s.structures[cellIndex(s, 3, 3)] = { kind: 'smoke', ownerId: 1 };
      s.ship = { x: 2, y: 2, callerId: 1, arrivesTurn: 99, leavesTurn: 100 };
    });
    expect(smoke.state.ship).toBeNull();
    expect(smoke.events.some((e) => e.type === 'smokeOut')).toBe(true);
  });

  it('世界を動かさないゲームでは天候も動物もない', () => {
    const quiet = createGame('quiet', 3);
    expect(quiet.npcs).toEqual([]);
    const next = resolveTurn(resolveTurn(quiet, {}).state, {}).state;
    expect(next.weather).toBe('sunny');
  });
});

describe('動物', () => {
  it('開始時に小動物と猿がいて、霧の中では見えない', () => {
    const state = createGame('zoo', 3, { world: true });
    expect(state.npcs.filter((n) => n.kind === 'critter').length).toBe(3);
    expect(state.npcs.filter((n) => n.kind === 'monkey').length).toBe(1);
    const seen = getPlayerView(state, 0).cells.flatMap((c) => c.npcs);
    expect(seen.length).toBeLessThan(state.npcs.length);
  });

  it('小動物は人が隣にいると逃げ、通ったマスに足跡が残る', () => {
    const state = arena(9);
    const me = state.players[0];
    const npc = addNpc(state, { kind: 'critter', x: me.x + 1, y: me.y, hp: 1 });
    const next = resolveTurn(state, {}).state;
    const moved = next.npcs.find((n) => n.id === npc.id)!;
    expect(Math.max(Math.abs(moved.x - me.x), Math.abs(moved.y - me.y))).toBeGreaterThanOrEqual(1);
    expect(next.footprints.length).toBeGreaterThan(0);
  });

  it('動物は海と山に入らない', () => {
    const state = arena(9);
    const me = state.players[0];
    const npc = addNpc(state, { kind: 'critter', x: me.x - 6, y: me.y, hp: 1 });
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      state.map.terrain[cellIndex(state, npc.x + dx, npc.y + dy)] = (dx === 0 ? 'mountain' : 'sea') as TerrainId;
    }
    expect(resolveTurn(state, {}).state.npcs.find((n) => n.id === npc.id)).toMatchObject({ x: npc.x, y: npc.y });
  });

  it('猿は食料を持つ人に近づいて盗み、倒すと取り返せる', () => {
    const state = arena(9);
    const me = state.players[0];
    me.inventory = [{ item: 'fruit', count: 1 }];
    addNpc(state, { kind: 'monkey', x: me.x + 1, y: me.y, hp: 2 });
    const r = resolveTurn(state, {});
    expect(events(r.steps)).toContainEqual({ type: 'monkeyStole', playerId: 0, item: 'fruit' });
    expect(r.state.players[0].inventory).toEqual([]);
    const friend = arena(9);
    friend.players[0].secretTrait = 'beast_friend';
    friend.players[0].inventory = [{ item: 'fruit', count: 1 }];
    addNpc(friend, { kind: 'monkey', x: friend.players[0].x + 1, y: friend.players[0].y, hp: 2 });
    expect(resolveTurn(friend, {}).state.players[0].inventory).toHaveLength(1);
  });

  it('狩りが当たると肉が手に入る。巣があれば当たりやすく、解体で増える', () => {
    let meat = 0;
    for (let seed = 0; seed < 100 && !meat; seed++) {
      const state = arena();
      const me = state.players[0];
      const npc = addNpc(state, { kind: 'critter', x: me.x, y: me.y, hp: 1 });
      me.inventory = [{ item: 'stone_knife', count: 1 }];
      state.rngState = Math.imul(seed + 1, 2654435761);
      const r = applyAction(state, { type: 'hunt', playerId: 0, npcId: npc.id });
      const stack = r.state.players[0].inventory.find((s) => s.item === 'meat');
      if (stack) {
        meat = stack.count;
        expect(r.state.npcs.some((n) => n.id === npc.id)).toBe(false);
        expect(r.state.critterRespawns).toHaveLength(1);
      }
    }
    expect(meat).toBe(2);
  });

  it('大イノシシは縄張りの人に突進し、倒すと元軍人に戦果3点', () => {
    let hit = false;
    for (let seed = 0; seed < 100 && !hit; seed++) {
      const state = arena(9);
      const me = state.players[0];
      addNpc(state, { kind: 'boar', x: me.x + 1, y: me.y, hp: 8, homeX: me.x + 1, homeY: me.y });
      state.rngState = Math.imul(seed + 1, 2654435761);
      const r = resolveTurn(state, {});
      if (events(r.steps).some((e) => e.type === 'npcHit' && e.kind === 'boar')) {
        hit = true;
        expect(r.state.players[0].hp).toBeLessThanOrEqual(8);
      }
    }
    expect(hit).toBe(true);

    for (let seed = 0; seed < 100; seed++) {
      const state = arena();
      const me = state.players[0];
      me.job = 'soldier';
      const npc = addNpc(state, { kind: 'boar', x: me.x, y: me.y, hp: 1, homeX: me.x, homeY: me.y });
      state.rngState = Math.imul(seed + 1, 2654435761);
      const r = applyAction(state, { type: 'hunt', playerId: 0, npcId: npc.id });
      if (r.state.players[0].progress.warPoints === 3) {
        expect(r.state.players[0].inventory.find((s) => s.item === 'meat')?.count).toBe(3);
        return;
      }
    }
    throw new Error('倒せませんでした');
  });

  it('漂流者は手当てするとお礼をくれて同行し、医師の回数に数える。放置すると力尽きる', () => {
    const state = arena();
    const me = state.players[0];
    me.job = 'doctor';
    const npc = addNpc(state, { kind: 'castaway', x: me.x, y: me.y, hp: 3, followerOf: null });
    const r = applyAction(state, { type: 'aid', playerId: 0, npcId: npc.id });
    expect(r.state.players[0].progress.healCount).toBe(1);
    expect(r.state.players[0].inventory.length).toBeGreaterThan(0);
    expect(r.state.npcs[0].followerOf).toBe(0);

    const plain = arena();
    addNpc(plain, { kind: 'castaway', x: plain.players[0].x, y: plain.players[0].y, hp: 1, followerOf: null });
    expect(applyAction(plain, { type: 'aid', playerId: 0, npcId: plain.npcs[0].id }).events[0]).toMatchObject({ reason: 'missingMaterials' });
    const left = resolveTurn(plain, {}).state;
    expect(left.npcs).toEqual([]);
    expect(Object.keys(left.relics)).toHaveLength(1);
  });

  it('群れはまっすぐ進み、通り道の人はHP−1', () => {
    const state = arena(9);
    const me = state.players[0];
    addNpc(state, { kind: 'herd', x: me.x - 1, y: me.y, dx: 1, dy: 0 });
    const r = resolveTurn(state, {});
    expect(events(r.steps)).toContainEqual({ type: 'npcHit', playerId: 0, kind: 'herd', damage: 1 });
  });
});

describe('潮位上昇', () => {
  it('7日目から砂浜が1日1か所ずつ、前の日に予告されて沈む', () => {
    const state = arena(9);
    const cell = cellIndex(state, 2, 2);
    state.map.terrain[cell] = 'beach';
    state.turn = 12; // 次は7日目の朝
    const first = applyAction(state, { type: 'endTurn' });
    expect(first.events.some((e) => e.type === 'tideNotice')).toBe(true);
    expect(first.state.sinkNext).toEqual([cell]);
    expect(getPlayerView(first.state, 0).marks.some((m) => m.kind === 'sink')).toBe(true);
    let next = applyAction(first.state, { type: 'endTurn' }).state;
    next = applyAction(next, { type: 'endTurn' }).state;
    expect(next.map.terrain[cell]).toBe('sea');
    expect(next.sunk).toContain(cell);
  });

  it('乗っている人は隣の陸へ押し出され、泳ぎ上手は沈んだマスを渡れる', () => {
    const state = arena(9);
    const me = state.players[0];
    const cell = cellIndex(state, me.x, me.y);
    state.map.terrain[cell] = 'beach';
    state.sinkNext = [cell];
    state.turn = 8;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.map.terrain[cellIndex(next, next.players[0].x, next.players[0].y)]).not.toBe('sea');

    next.players[0].publicTrait = 'swimmer';
    next.players[0].x = (cell % next.map.width) - 1;
    next.players[0].y = Math.floor(cell / next.map.width);
    next.players[0].ap = 3;
    next.weather = 'sunny';
    expect(applyAction(next, { type: 'move', playerId: 0, direction: 'right' }).state.players[0].ap).toBe(1);
  });
});

describe('最終局面', () => {
  function final(): GameState {
    const state = arena(1);
    state.turn = 20;
    return applyAction(state, { type: 'endTurn' }).state;
  }

  it('11日目に始まり、霧がなくなり、外側から沈み、特殊勝利がなくなる', () => {
    const state = final();
    expect(state.finalPhase).toBe(true);
    const view = getPlayerView(state, 0);
    expect(view.cells.every((c) => c.fog === 'visible')).toBe(true);
    expect(view.marks.filter((m) => m.kind === 'sink').length).toBeGreaterThan(0);
    const land = state.map.terrain.filter((t) => t !== 'sea').length;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.map.terrain.filter((t) => t !== 'sea').length).toBeLessThan(land);
    state.players[0].job = 'soldier';
    state.players[0].progress.warPoints = 99;
    expect(resolveTurn(state, {}).state.finished).toBe(false);
  });

  it('全員に毎ターンHP−1。休息で回復せず、隠れられない', () => {
    const state = final();
    state.players[0].hp = 5;
    const next = applyAction(state, { type: 'endTurn' }).state;
    expect(next.players[0].hp).toBeLessThan(5);
    expect(applyAction(state, { type: 'rest', playerId: 0 }).state.players[0].hp).toBe(5);
    state.map.terrain[cellIndex(state, state.players[0].x, state.players[0].y)] = 'forest';
    expect(applyAction(state, { type: 'hide', playerId: 0 }).events[0]).toMatchObject({ reason: 'cannotHide' });
  });

  it('沈んだマスに残ると脱落し、泳ぎ上手は1ターン長く耐える', () => {
    const state = final();
    const me = state.players[0];
    state.map.terrain[cellIndex(state, me.x, me.y)] = 'sea';
    expect(resolveTurn(state, {}).state.players[0].alive).toBe(false);
    const swim = final();
    swim.players[0].publicTrait = 'swimmer';
    swim.map.terrain[cellIndex(swim, swim.players[0].x, swim.players[0].y)] = 'sea';
    expect(resolveTurn(swim, {}).state.players[0].alive).toBe(true);
  });

  it('全員が同時に倒れたら、直前のHPが高い人の勝ち', () => {
    const state = final();
    state.players[0].hp = 1;
    state.players[1].hp = 1;
    state.players[0].hpAtTurnStart = 1;
    state.players[1].hpAtTurnStart = 1;
    state.players[0].progress.warPoints = 5;
    const r = resolveTurn(state, {}).state;
    expect(r).toMatchObject({ finished: true, winnerId: 0 });
  });

  it('必ず決着がつく', () => {
    for (let seed = 0; seed < 20; seed++) {
      let state = createGame(`end${seed}`, 3, { world: true });
      for (let i = 0; i < 60 && !state.finished; i++) state = resolveTurn(state, {}).state;
      expect(state.finished).toBe(true);
    }
  });
});

describe('幽霊', () => {
  function ghostGame() {
    const state = arena();
    state.players[1].alive = false;
    state.players[1].hp = 0;
    state.players[1].killerId = 0;
    return state;
  }

  it('霧のない全マップと生存者の位置が見えるが、所持品は見えない', () => {
    const state = ghostGame();
    state.players[0].inventory = [{ item: 'honey', count: 1 }];
    const view = getPlayerView(state, 1);
    expect(view.cells.every((c) => c.fog === 'visible')).toBe(true);
    expect(view.cells.flatMap((c) => c.figures).some((f) => f.kind === 'player' && f.id === 0)).toBe(true);
    expect(view.ghost).toMatchObject({ hauntReady: true, curseReady: true });
    expect(JSON.stringify(view)).not.toContain('honey');
  });

  it('幽霊にできる予約だけを受け付ける', () => {
    const view = getPlayerView(ghostGame(), 1);
    const haunt: PlanAction = { type: 'haunt', kind: 'fog', x: 3, y: 3 };
    expect(projectPlan(view, [haunt]).ok).toBe(true);
    expect(projectPlan(view, [haunt, haunt]).ok).toBe(false);
    expect(projectPlan(view, [{ type: 'gather' }]).ok).toBe(false);
    const living = getPlayerView(ghostGame(), 0);
    expect(projectPlan(living, [haunt]).ok).toBe(false);
  });

  it('濃霧で視界が狭くなり、1日に1回まで', () => {
    const state = ghostGame();
    const me = state.players[0];
    const r = resolveTurn(state, { 1: [{ type: 'haunt', kind: 'fog', x: me.x, y: me.y }] });
    const fogged = r.state.fog[0];
    expect(fogged.cells).toContain(cellIndex(state, me.x, me.y));
    expect(getPlayerView(r.state, 1).ghost!.hauntReady).toBe(r.state.turn % 2 === 1 ? true : false);
    const again = applyAction(r.state, { type: 'haunt', playerId: 1, kind: 'fog', x: 1, y: 1 });
    expect(again.state.fog.length).toBeGreaterThanOrEqual(1);
  });

  it('物音は足跡に見え、守護は採取率を上げる', () => {
    const state = ghostGame();
    const noise = applyAction(state, { type: 'haunt', playerId: 1, kind: 'noise', x: 3, y: 3 }).state;
    expect(noise.footprints.some((f) => f.cell === cellIndex(state, 3, 3))).toBe(true);
    const bless = applyAction(state, { type: 'haunt', playerId: 1, kind: 'bless', x: 3, y: 3 }).state;
    expect(bless.blessed).toHaveLength(1);
  });

  it('祟りは自分を倒した相手の命中率を下げ、1回だけ', () => {
    const state = ghostGame();
    const cursed = applyAction(state, { type: 'curse', playerId: 1 }).state;
    expect(cursed.players[0].cursedTurn).toBe(state.turn + 1);
    expect(applyAction(cursed, { type: 'curse', playerId: 1 }).events[0]).toMatchObject({ reason: 'eliminated' });
  });

});

describe('CPU', () => {
  function cpuGame(seed: string, players: number) {
    let draft = createDraft(seed, players, players);
    for (let i = 0; i < 40 && draft.phase !== 'done'; i++) draft = draftAuto(draft);
    return createGame(seed, players, { setups: finishDraft(draft), world: true });
  }

  it.each(['easy', 'normal', 'hard'] as CpuLevel[])('%s：CPUだけで最後まで遊べて、予約はいつも正しい', (level) => {
    for (let g = 0; g < 8; g++) {
      let state = cpuGame(`cpu-${level}-${g}`, 3 + (g % 3));
      let turns = 0;
      while (!state.finished && turns < 80) {
        const plans: Record<number, PlanAction[]> = {};
        for (const player of state.players) {
          const view = getPlayerView(state, player.id);
          const rng = new Rng(state.rngState + player.id);
          const plan = player.alive ? planForCpu(view, level, rng) : ghostPlanForCpu(view, rng);
          expect(projectPlan(view, plan).ok).toBe(true);
          plans[player.id] = plan;
        }
        state = resolveTurn(state, plans).state;
        turns += 1;
      }
      expect(state.finished).toBe(true);
      expect(state.winnerId).not.toBeNull();
    }
  });

  it('霧の向こうの情報を使わない（見え方が同じなら同じ予約）', () => {
    const state = cpuGame('fair', 3);
    const view = getPlayerView(state, 0);
    const a = planForCpu(view, 'hard', new Rng(1));
    const other: GameState = JSON.parse(JSON.stringify(state));
    // 見えていない他の人の位置を変えても判断は変わらない
    other.players[1].x = 1;
    other.players[1].y = 1;
    const seen = getPlayerView(state, 0).cells.flatMap((c) => c.figures).filter((f) => f.kind !== 'self');
    if (seen.length === 0) expect(planForCpu(getPlayerView(other, 0), 'hard', new Rng(1))).toEqual(a);
  });

  it('同じシードなら同じ展開になる', () => {
    const play = () => {
      let state = cpuGame('replay-cpu', 4);
      for (let i = 0; i < 12 && !state.finished; i++) {
        const plans: Record<number, PlanAction[]> = {};
        for (const p of state.players) {
          plans[p.id] = p.alive ? planForCpu(getPlayerView(state, p.id), 'normal', new Rng(state.rngState + p.id)) : [];
        }
        state = resolveTurn(state, plans).state;
      }
      return state;
    };
    expect(play()).toEqual(play());
  });
});
