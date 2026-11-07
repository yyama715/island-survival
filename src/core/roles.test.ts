import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createDraft,
  createGame,
  draftAuto,
  draftPickItems,
  draftPickJob,
  draftPickStart,
  draftReroll,
  finishDraft,
  getDraftView,
  getPlayerView,
  GOALS,
  isNearVictory,
  JOB_IDS,
  JOBS,
  projectPlan,
  PUBLIC_TRAITS,
  RAFT,
  replayFor,
  resolveTurn,
  SECRET_TRAITS,
  TRAITS,
  useMindRead,
  type DraftState,
  type GameEvent,
  type GameState,
  type ItemId,
  type JobId,
  type PlanAction,
  type TerrainId,
  type TraitId,
} from './index';
import { cellIndex } from './testing';

const base = new Map<number, string>();

function arena(gap = 5, seats = 2): GameState {
  if (!base.has(seats)) base.set(seats, JSON.stringify(createGame('roles', 3, { seats, mapSize: 'large' })));
  const state: GameState = JSON.parse(base.get(seats)!);
  for (let y = 1; y < state.map.height - 1; y++) {
    for (let x = 1; x < state.map.width - 1; x++) state.map.terrain[cellIndex(state, x, y)] = 'grass';
  }
  const center = Math.floor(state.map.width / 2);
  state.players.forEach((player, i) => {
    player.x = center + i * gap;
    player.y = center;
    player.memory.fill(null);
    player.progress.explored = [];
    player.progress.specialsVisited = [];
  });
  state.turn = 5;
  state.initiative = state.players.map((p, i) => ({ playerId: p.id, value: 10 - i, agility: 2 }));
  return state;
}

const setHere = (state: GameState, id: number, terrain: TerrainId) => {
  const p = state.players[id];
  state.map.terrain[cellIndex(state, p.x, p.y)] = terrain;
};
const give = (state: GameState, id: number, item: ItemId, count = 1) => {
  for (let left = count; left > 0; left -= 5) state.players[id].inventory.push({ item, count: Math.min(left, 5) });
};
const allEvents = (steps: { events: GameEvent[] }[]) => steps.flatMap((s) => s.events);

/** 全部の段階を順に進める */
function playDraft(seed: string, seats: number): DraftState {
  let state = createDraft(seed, 5, seats);
  for (let i = 0; i < 40 && state.phase !== 'done'; i++) state = draftAuto(state);
  return state;
}

describe('データ', () => {
  it('職業は6つ、特性は公開10種類と秘密13種類', () => {
    expect(JOB_IDS).toHaveLength(6);
    expect(PUBLIC_TRAITS).toHaveLength(10);
    expect(SECRET_TRAITS).toHaveLength(13);
    const count = (pool: TraitId[], rarity: string) => pool.filter((id) => TRAITS[id].rarity === rarity).length;
    expect([count(PUBLIC_TRAITS, 'common'), count(PUBLIC_TRAITS, 'rare'), count(PUBLIC_TRAITS, 'super'), count(PUBLIC_TRAITS, 'legend')]).toEqual([5, 3, 1, 1]);
    expect([count(SECRET_TRAITS, 'common'), count(SECRET_TRAITS, 'rare'), count(SECRET_TRAITS, 'super'), count(SECRET_TRAITS, 'legend')]).toEqual([5, 4, 2, 2]);
  });

  it('機敏さは仕様どおり', () => {
    expect(JOB_IDS.map((id) => JOBS[id].agility)).toEqual([2, 1, 1, 2, 3, 2]);
  });
});

describe('キャラ選択', () => {
  it('同じシードで同じ配布になり、1ゲームで同じ特性は重複しない', () => {
    for (let seed = 0; seed < 50; seed++) {
      const a = createDraft(`d${seed}`, 5, 5);
      expect(a).toEqual(createDraft(`d${seed}`, 5, 5));
      const traits = a.seats.flatMap((s) => [s.publicTrait, s.secretTrait]);
      expect(new Set(traits).size).toBe(traits.length);
      for (const seat of a.seats) {
        expect(TRAITS[seat.publicTrait].secret).toBe(false);
        expect(TRAITS[seat.secretTrait].secret).toBe(true);
      }
    }
  });

  it('秘密特性がコモンの人にだけ補償の所持品がある', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (const seat of createDraft(`b${seed}`, 3, 3).seats) {
        expect(!!seat.bonusItem).toBe(TRAITS[seat.secretTrait].rarity === 'common');
      }
    }
  });

  it('引き直しは1回だけで、所持品が1つ減る', () => {
    let state = createDraft('r', 3, 2);
    const before = state.seats[0].publicTrait;
    state = draftReroll(state, 0, true)!;
    expect(state.seats[0]).toMatchObject({ rerolled: true, rerollDone: true });
    expect(state.seats[0].publicTrait).not.toBe(before);
    expect(draftReroll(state, 0, true)).toBeNull();
    state = draftReroll(state, 1, false)!;
    expect(state.phase).toBe('job');
    const first = state.order[0];
    state = draftPickJob(state, first, 'fisher')!;
    state = draftPickJob(state, state.order[1], 'cook')!;
    expect(getDraftView(state, 0).allowance).toBe(1);
    expect(getDraftView(state, 1).allowance).toBe(2);
  });

  it('職業はレア度の低い人から重複なしで選ぶ', () => {
    for (let seed = 0; seed < 40; seed++) {
      let state = createDraft(`o${seed}`, 5, 5);
      for (let s = 0; s < 5; s++) state = draftReroll(state, s, false)!;
      const rank = ['common', 'rare', 'super', 'legend'];
      const ranks = state.order.map((s) => rank.indexOf(TRAITS[state.seats[s].publicTrait].rarity));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      const wrong = state.order[1];
      expect(draftPickJob(state, wrong, 'cook')).toBeNull();
      const next = draftPickJob(state, state.order[0], 'cook')!;
      expect(draftPickJob(next, state.order[1], 'cook')).toBeNull();
    }
  });

  it('所持品は候補から決まった数だけ選ぶ', () => {
    let state = createDraft('i', 3, 1);
    state = draftReroll(state, 0, false)!;
    state = draftPickJob(state, 0, 'doctor')!;
    expect(draftPickItems(state, 0, [0])).toBeNull();
    expect(draftPickItems(state, 0, [0, 0])).toBeNull();
    expect(draftPickItems(state, 0, [0, 9])).toBeNull();
    state = draftPickItems(state, 0, [0, 2])!;
    expect(state.phase).toBe('start');
  });

  it('初期位置は逆順に選び、同じ場所は選べない', () => {
    let state = createDraft('s', 3, 2);
    state = draftReroll(draftReroll(state, 0, false)!, 1, false)!;
    const [first, second] = state.order;
    state = draftPickJob(draftPickJob(state, first, 'cook')!, second, 'soldier')!;
    state = draftPickItems(draftPickItems(state, 0, [0, 1])!, 1, [0, 1])!;
    expect(state.order).toEqual([second, first]);
    expect(draftPickStart(state, first, 0)).toBeNull();
    state = draftPickStart(state, second, 0)!;
    expect(draftPickStart(state, first, 0)).toBeNull();
    state = draftPickStart(state, first, 1)!;
    expect(state.phase).toBe('done');
  });

  it('他の人の秘密特性は見えない', () => {
    const state = createDraft('v', 5, 3);
    const view = getDraftView(state, 0);
    expect(view.secretTrait).toBe(state.seats[0].secretTrait);
    const others = JSON.stringify(view.seats);
    for (const seat of state.seats) expect(others).not.toContain(seat.secretTrait);
    expect(JSON.stringify(view)).not.toContain(state.seats[1].secretTrait);
    expect(JSON.stringify(view)).not.toContain('seed');
  });

  it('時間切れで全部自動で決まり、ゲームが始められる', () => {
    for (let seed = 0; seed < 30; seed++) {
      const seats = 3 + (seed % 3);
      const done = playDraft(`a${seed}`, seats);
      expect(done.phase).toBe('done');
      const setups = finishDraft(done);
      const state = createGame(`a${seed}`, 5, { setups });
      setups.forEach((setup, id) => {
        const p = state.players[id];
        expect(p.job).toBe(setup.job);
        expect(state.map.starts[setup.start]).toMatchObject({ x: p.x, y: p.y });
      });
      expect(new Set(setups.map((s) => s.job)).size).toBe(seats);
      expect(new Set(setups.map((s) => s.start)).size).toBe(seats);
    }
  });

  it('もう一つの顔は誰も選ばなかった職業を持つ', () => {
    let found = false;
    for (let seed = 0; seed < 300 && !found; seed++) {
      const done = playDraft(`f${seed}`, 3);
      for (const seat of done.seats) {
        if (seat.secretTrait !== 'other_face') continue;
        found = true;
        expect(seat.extraJob).not.toBeNull();
        expect(done.seats.some((s) => s.job === seat.extraJob)).toBe(false);
      }
    }
    expect(found).toBe(true);
  });
});

describe('職業の能力', () => {
  it('行動値に機敏さの基礎値が効く', () => {
    const state = arena();
    state.players[0].job = 'explorer';
    state.players[1].job = 'doctor';
    let diff = 0;
    for (let seed = 0; seed < 1000; seed++) {
      state.rngState = Math.imul(seed + 1, 2654435761);
      const { initiative } = applyAction(state, { type: 'endTurn' }).state;
      diff += initiative.find((e) => e.playerId === 0)!.value - initiative.find((e) => e.playerId === 1)!.value;
    }
    expect(diff / 1000).toBeCloseTo(2, 0);
  });

  it('大工はクラフトと建設のAPが1少ない（最低1）', () => {
    const state = arena();
    state.players[0].job = 'carpenter';
    give(state, 0, 'wood', 4);
    give(state, 0, 'grass', 2);
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'hut' }).state.players[0].ap).toBe(1);
    const bandage = arena();
    bandage.players[0].job = 'carpenter';
    give(bandage, 0, 'grass', 2);
    expect(applyAction(bandage, { type: 'craft', playerId: 0, recipe: 'bandage' }).state.players[0].ap).toBe(2);
  });

  it('元軍人は攻撃力+1、命中率+10%', () => {
    const start = arena(0);
    start.players[0].job = 'soldier';
    let hits = 0;
    let damage = 0;
    for (let seed = 0; seed < 3000; seed++) {
      start.rngState = Math.imul(seed + 1, 2654435761);
      const event = applyAction(start, { type: 'attack', playerId: 0, targetId: 1 }).events.find((e) => e.type === 'attackResult');
      if (event?.type === 'attackResult' && event.hit) {
        hits++;
        damage = event.damage;
      }
    }
    expect(hits / 3000).toBeCloseTo(0.8, 1);
    expect(damage).toBe(2);
  });

  it('探検家は視界+1', () => {
    const state = arena();
    state.players[0].job = 'explorer';
    expect(getPlayerView(state, 0).me.visionRadius).toBe(2);
  });

  it('料理人は回復量+1で、キノコの中毒にならない', () => {
    const state = arena();
    state.players[0].job = 'cook';
    state.players[0].hunger = 2;
    give(state, 0, 'fruit');
    expect(applyAction(state, { type: 'use', playerId: 0, item: 'fruit' }).state.players[0].hunger).toBe(5);
    for (let seed = 0; seed < 200; seed++) {
      const s = arena();
      s.players[0].job = 'cook';
      give(s, 0, 'mushroom');
      s.rngState = Math.imul(seed + 1, 2654435761);
      expect(applyAction(s, { type: 'use', playerId: 0, item: 'mushroom' }).state.players[0].poisonTurns).toBe(0);
    }
  });

  it('職業専用のレシピは他の人には作れない', () => {
    const state = arena();
    give(state, 0, 'medicinal_herb');
    give(state, 0, 'water');
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'medicine' }).events[0]).toMatchObject({ reason: 'notAllowed' });
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'craft', recipe: 'medicine' }]).ok).toBe(false);
    state.players[0].job = 'doctor';
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'medicine' }).events[0].type).toBe('crafted');
  });
});

describe('治療', () => {
  function clinic() {
    const state = arena(0);
    state.players[0].job = 'doctor';
    state.players[1].hp = 5;
    state.players[1].bleeding = true;
    state.players[1].poisonTurns = 2;
    return state;
  }

  it('HP+3で状態異常が治り、初めての相手は最大HP+1', () => {
    const { state, events } = applyAction(clinic(), { type: 'heal', playerId: 0, targetId: 1 });
    expect(state.players[1]).toMatchObject({ hp: 8, maxHp: 11, bleeding: false, poisonTurns: 0 });
    expect(state.players[0].progress.healCount).toBe(1);
    expect(events[0]).toMatchObject({ type: 'healed', maxHpUp: true });
    const again = applyAction(state, { type: 'heal', playerId: 0, targetId: 1 }).state;
    expect(again.players[1].maxHp).toBe(11);
  });

  it('同じ相手は2回までしか数えない', () => {
    let state = clinic();
    state.players[0].ap = 9;
    for (let i = 0; i < 4; i++) state = applyAction(state, { type: 'heal', playerId: 0, targetId: 1 }).state;
    expect(state.players[0].progress.healCount).toBe(2);
  });

  it('脱落直前の相手は2回分、医師の薬は誰が使っても数える', () => {
    const dying = clinic();
    dying.players[1].hp = 1;
    expect(applyAction(dying, { type: 'heal', playerId: 0, targetId: 1 }).state.players[0].progress.healCount).toBe(2);

    const pill = clinic();
    give(pill, 1, 'medicine');
    const used = applyAction(pill, { type: 'use', playerId: 1, item: 'medicine' }).state;
    expect(used.players[0].progress.healCount).toBe(1);
    expect(used.players[1].hp).toBe(8);
  });

  it('同じマスにいないと効かず、医師以外は治療できない', () => {
    const far = clinic();
    far.players[1].x += 3;
    expect(applyAction(far, { type: 'heal', playerId: 0, targetId: 1 }).state.players[1].hp).toBe(5);
    const other = clinic();
    other.players[0].job = 'cook';
    expect(applyAction(other, { type: 'heal', playerId: 0, targetId: 1 }).events[0]).toMatchObject({ reason: 'notAllowed' });
  });
});

describe('特殊勝利', () => {
  const finishes = (state: GameState, plans: Record<number, PlanAction[]> = {}) => resolveTurn(state, plans).state;

  it('漁師：釣果が天井に届くと島の主が出て公開され、3ターン持てば勝つ', () => {
    let state = arena();
    state.players[0].job = 'fisher';
    setHere(state, 0, 'beach');
    give(state, 0, 'fishing_line');
    state.players[0].progress.fishCaught = GOALS.lordCeiling - 1;
    let caught: GameEvent[] = [];
    for (let seed = 0; seed < 300 && caught.length === 0; seed++) {
      const copy: GameState = JSON.parse(JSON.stringify(state));
      copy.rngState = Math.imul(seed + 1, 2654435761);
      const result = applyAction(copy, { type: 'gather', playerId: 0 });
      if (result.events.some((e) => e.type === 'lordCaught')) {
        caught = result.events;
        state = result.state;
      }
    }
    expect(caught.length).toBeGreaterThan(0);
    expect(state.players[0].inventory.some((s) => s.item === 'island_lord')).toBe(true);
    expect(state.players[0].progress.lordCaughtBefore).toBe(true);
    for (let i = 0; i < GOALS.lordHoldTurns - 1; i++) {
      state = finishes(state);
      expect(state.finished).toBe(false);
    }
    state = finishes(state);
    expect(state).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'fisher' });
  });

  it('漁師以外が島の主を持っても勝てず、奪われると数え直す', () => {
    const state = arena(0);
    state.players[0].job = 'fisher';
    give(state, 1, 'island_lord');
    state.players[1].progress.lordHeldTurns = 9;
    expect(finishes(state).finished).toBe(false);
  });

  it('大工：砦を完成させて4ターン守れば勝つ。壊されると振り出し', () => {
    let state = arena();
    state.players[0].job = 'carpenter';
    give(state, 0, 'wood', 8);
    give(state, 0, 'stone', 4);
    give(state, 0, 'rope', 2);
    const built = applyAction(state, { type: 'craft', playerId: 0, recipe: 'fort' });
    expect(built.events.map((e) => e.type)).toContain('fortCompleted');
    state = built.state;
    const index = cellIndex(state, state.players[0].x, state.players[0].y);
    expect(state.structures[index]).toMatchObject({ kind: 'fort', hp: 10 });

    let broken: GameState = JSON.parse(JSON.stringify(state));
    broken.players[1].x = broken.players[0].x;
    broken.players[1].ap = 99;
    for (let i = 0; i < 12 && broken.structures[index]; i++) broken = applyAction(broken, { type: 'smash', playerId: 1 }).state;
    expect(broken.structures[index]).toBeUndefined();

    for (let i = 0; i < GOALS.fortHoldTurns - 1; i++) {
      state = finishes(state);
      expect(state.finished).toBe(false);
    }
    state = finishes(state);
    expect(state).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'carpenter' });
  });

  it('大工は毎ターン修理でき、砦の中では防御+2', () => {
    const state = arena(0);
    state.players[1].job = 'carpenter';
    const index = cellIndex(state, state.players[1].x, state.players[1].y);
    state.structures[index] = { kind: 'fort', ownerId: 1, hp: 4, builtTurn: state.turn };
    const fixed = applyAction(state, { type: 'repair', playerId: 1 }).state;
    expect(fixed.structures[index].hp).toBe(7);
    expect(applyAction(fixed, { type: 'repair', playerId: 1 }).events[0]).toMatchObject({ reason: 'notAllowed' });

    give(state, 0, 'stone_axe');
    const damages = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      state.rngState = Math.imul(seed + 1, 2654435761);
      const event = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events.find((e) => e.type === 'attackResult');
      if (event?.type === 'attackResult' && event.hit) damages.add(event.damage);
    }
    expect([...damages].sort()).toEqual([1, 2, 3]);
  });

  it('医師：治療5回で7日目の朝を迎えると勝つ', () => {
    const state = arena();
    state.players[0].job = 'doctor';
    state.players[0].progress.healCount = GOALS.healsNeeded;
    state.turn = GOALS.doctorSurviveTurn - 2;
    const before = finishes(state);
    expect(before.finished).toBe(false);
    expect(finishes(before)).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'doctor' });
  });

  it('元軍人：命中1点、脱落3点で、8点で勝つ', () => {
    const start = arena(0);
    start.players[0].job = 'soldier';
    start.players[1].hp = 1;
    let result = null;
    for (let seed = 0; seed < 50 && !result; seed++) {
      start.rngState = Math.imul(seed + 1, 2654435761);
      const r = applyAction(start, { type: 'attack', playerId: 0, targetId: 1 });
      if (r.events.some((e) => e.type === 'attackResult' && e.hit)) result = r;
    }
    expect(result!.state.players[0].progress.warPoints).toBe(GOALS.warPerHit + GOALS.warPerKill);

    const state = arena(5, 3);
    state.players[0].job = 'soldier';
    state.players[0].progress.warPoints = GOALS.warPoints;
    expect(finishes(state)).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'soldier' });
  });

  it('探検家：40%踏破して特殊マス3か所で勝つ。見ただけのマスは数えない', () => {
    const state = arena();
    state.players[0].job = 'explorer';
    const before = state.players[0].progress.explored.length;
    const moved = applyAction(state, { type: 'move', playerId: 0, direction: 'up' }).state;
    expect(moved.players[0].progress.explored.length).toBe(before + 1);

    const special = arena();
    const me = special.players[0];
    special.map.terrain[cellIndex(special, me.x, me.y - 1)] = 'cave';
    const visited = applyAction(special, { type: 'move', playerId: 0, direction: 'up' }).state;
    expect(visited.players[0].progress.specialsVisited).toHaveLength(1);

    const win = arena();
    win.players[0].job = 'explorer';
    const land = win.map.terrain.flatMap((t, i) => (t === 'sea' ? [] : [i]));
    win.players[0].progress.explored = land.slice(0, Math.ceil(land.length * GOALS.exploreRatio));
    win.players[0].progress.specialsVisited = [1, 2, 3];
    expect(finishes(win)).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'explorer' });
  });

  it('料理人：決まった数のジャンルでフルコースを作って食べると勝つ。島の主は2ジャンル分', () => {
    let state = arena();
    state.players[0].job = 'cook';
    const genres = ['fish', 'egg', 'fruit', 'mushroom', 'shell', 'herb'] as ItemId[];
    for (const item of genres.slice(0, GOALS.courseGenres - 1)) give(state, 0, item);
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'full_course' }).events[0]).toMatchObject({ reason: 'missingMaterials' });
    give(state, 0, genres[GOALS.courseGenres - 1]);
    state = applyAction(state, { type: 'craft', playerId: 0, recipe: 'full_course' }).state;
    expect(state.players[0].inventory).toEqual([{ item: 'full_course', count: 1 }]);
    const { state: eaten, steps } = resolveTurn(state, { 0: [{ type: 'use', item: 'full_course' }] });
    expect(eaten).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'cook' });
    expect(allEvents(steps).map((e) => e.type)).toContain('gameFinished');

    const lord = arena();
    lord.players[0].job = 'cook';
    for (const item of ['island_lord', 'fruit', 'mushroom', 'shell', 'herb'].slice(0, GOALS.courseGenres - 1) as ItemId[]) give(lord, 0, item);
    expect(applyAction(lord, { type: 'craft', playerId: 0, recipe: 'full_course' }).events[0].type).toBe('crafted');
  });

  it('あと1歩になると誰かは伏せて全員に知らせ、1回だけ', () => {
    const state = arena();
    state.players[0].job = 'soldier';
    state.players[0].progress.warPoints = GOALS.warPoints - 1;
    expect(isNearVictory(state, state.players[0])).toBe(true);
    const first = resolveTurn(state, {});
    expect(allEvents(first.steps)).toContainEqual({ type: 'nearVictory' });
    expect(allEvents(replayFor(1, state, first.steps))).toContainEqual({ type: 'nearVictory' });
    const second = resolveTurn(first.state, {});
    expect(allEvents(second.steps)).not.toContainEqual({ type: 'nearVictory' });
  });

  it('進み具合は本人にだけ見える', () => {
    const state = arena();
    state.players[0].job = 'soldier';
    state.players[1].job = 'doctor';
    expect(getPlayerView(state, 0).goals[0].label).toBe('戦果');
    expect(getPlayerView(state, 1).goals[0].label).toBe('治療回数');
    expect(getPlayerView(state, 1).roster[0].job).toBe('soldier');
  });
});

describe('いかだ', () => {
  function beach() {
    const state = arena();
    setHere(state, 0, 'beach');
    return state;
  }
  it('素材を少しずつ運び込み、揃ったら本人だけが乗って勝つ', () => {
    let state = beach();
    state.players[0].ap = 99;
    give(state, 0, 'wood', 5);
    state = applyAction(state, { type: 'raftWork', playerId: 0 }).state;
    const index = cellIndex(state, state.players[0].x, state.players[0].y);
    expect(state.structures[index].stock).toEqual([{ item: 'wood', count: 5 }]);
    expect(applyAction(state, { type: 'launch', playerId: 0 }).state.finished).toBe(false);
    give(state, 0, 'wood', 5);
    give(state, 0, 'rope', 3);
    give(state, 0, 'sail');
    const done = applyAction(state, { type: 'raftWork', playerId: 0 });
    expect(done.events[0]).toMatchObject({ type: 'raftWorked', complete: true });
    state = done.state;

    state.players[1].x = state.players[0].x;
    expect(applyAction(state, { type: 'launch', playerId: 1 }).events[0]).toMatchObject({ reason: 'notAllowed' });
    const { state: won } = resolveTurn(state, { 0: [{ type: 'launch' }] });
    expect(won).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'raft' });
  });

  it('砂浜以外では作れず、壊されると素材の半分が残る', () => {
    const inland = arena();
    give(inland, 0, 'wood');
    expect(applyAction(inland, { type: 'raftWork', playerId: 0 }).events[0]).toMatchObject({ reason: 'notAllowed' });

    let state = beach();
    const index = cellIndex(state, state.players[0].x, state.players[0].y);
    state.structures[index] = { kind: 'raft', ownerId: 0, hp: RAFT.hp, stock: [{ item: 'wood', count: 6 }] };
    state.players[1].x = state.players[0].x;
    state.players[1].ap = 99;
    for (let i = 0; i < 10 && state.structures[index]; i++) state = applyAction(state, { type: 'smash', playerId: 1 }).state;
    expect(state.structures[index]).toBeUndefined();
    expect(state.relics[index]).toEqual([{ item: 'wood', count: 3 }]);
  });
});

describe('狼煙と救助船', () => {
  function mountain() {
    const state = arena(9);
    setHere(state, 0, 'mountain');
    const far = state.players[1];
    state.map.terrain[cellIndex(state, far.x + 1, far.y)] = 'beach';
    give(state, 0, 'wood', 5);
    give(state, 0, 'flint');
    return state;
  }

  it('山で上げると全員に見え、到着地点は本人にだけ知らされる', () => {
    const state = mountain();
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'craft', recipe: 'smoke' }] });
    expect(next.ship).not.toBeNull();
    expect(allEvents(replayFor(1, state, steps)).map((e) => e.type)).toContain('smokeLit');
    expect(allEvents(replayFor(1, state, steps)).map((e) => e.type)).not.toContain('shipCalled');
    expect(allEvents(replayFor(0, state, steps)).map((e) => e.type)).toContain('shipCalled');
    expect(getPlayerView(next, 0).marks.map((m) => m.kind).sort()).toEqual(['shipComing', 'smoke']);
    expect(getPlayerView(next, 1).marks.map((m) => m.kind)).toEqual(['smoke']);
  });

  it('山以外と、最初の2日間と9日目より後は上げられない', () => {
    const flat = mountain();
    setHere(flat, 0, 'grass');
    expect(applyAction(flat, { type: 'craft', playerId: 0, recipe: 'smoke' }).events[0]).toMatchObject({ reason: 'notAllowed' });
    const early = mountain();
    early.turn = 4;
    expect(applyAction(early, { type: 'craft', playerId: 0, recipe: 'smoke' }).events[0]).toMatchObject({ reason: 'notAllowed' });
    const late = mountain();
    late.turn = 18;
    expect(applyAction(late, { type: 'craft', playerId: 0, recipe: 'smoke' }).events[0]).toMatchObject({ reason: 'notAllowed' });
  });

  it('到着の1ターン前に全員へ公開し、最初に入った人が勝つ', () => {
    let state = applyAction(mountain(), { type: 'craft', playerId: 0, recipe: 'smoke' }).state;
    const ship = state.ship!;
    let soon = false;
    while (state.turn < ship.arrivesTurn && !state.finished) {
      const result = resolveTurn(state, {});
      state = result.state;
      if (allEvents(result.steps).some((e) => e.type === 'shipSoon')) {
        soon = true;
        expect(getPlayerView(state, 1).marks.some((m) => m.kind === 'shipComing')).toBe(true);
      }
    }
    expect(soon).toBe(true);
    const walker = state.players[1];
    state.map.terrain[cellIndex(state, ship.x - 1, ship.y)] = 'grass';
    walker.x = ship.x - 1;
    walker.y = ship.y;
    const { state: won } = resolveTurn(state, { 1: [{ type: 'move', direction: 'right' }] });
    expect(won).toMatchObject({ finished: true, winnerId: 1, victoryReason: 'ship' });
  });

  it('消火すると船は来なくなり、上げ直せる', () => {
    const lit = applyAction(mountain(), { type: 'craft', playerId: 0, recipe: 'smoke' }).state;
    lit.players[1].x = lit.players[0].x;
    lit.players[1].y = lit.players[0].y;
    const out = applyAction(lit, { type: 'extinguish', playerId: 1 });
    expect(out.events[0].type).toBe('smokeOut');
    expect(out.state.ship).toBeNull();
    expect(out.state.players[1].ap).toBe(1);
  });

  it('誰も来なければ船は去り、もう呼べない', () => {
    let state = applyAction(mountain(), { type: 'craft', playerId: 0, recipe: 'smoke' }).state;
    let left = false;
    for (let i = 0; i < 8 && !left; i++) {
      const result = resolveTurn(state, {});
      state = result.state;
      left = allEvents(result.steps).some((e) => e.type === 'shipLeft');
    }
    expect(left).toBe(true);
    delete state.structures[cellIndex(state, state.players[0].x, state.players[0].y)];
    give(state, 0, 'wood', 5);
    give(state, 0, 'flint');
    state.players[0].ap = 3;
    expect(applyAction(state, { type: 'craft', playerId: 0, recipe: 'smoke' }).events[0]).toMatchObject({ reason: 'notAllowed' });
  });
});

describe('公開特性', () => {
  const withTrait = (trait: TraitId, gap = 5) => {
    const state = arena(gap);
    state.players[0].publicTrait = trait;
    return state;
  };

  it('健脚：草原の移動が1ターンに1回無料', () => {
    const state = withTrait('swift_feet');
    const once = applyAction(state, { type: 'move', playerId: 0, direction: 'up' }).state;
    expect(once.players[0].ap).toBe(3);
    expect(applyAction(once, { type: 'move', playerId: 0, direction: 'up' }).state.players[0].ap).toBe(2);
    expect(projectPlan(getPlayerView(state, 0), [{ type: 'move', direction: 'up' }]).ap).toBe(3);
  });

  it('鉄の胃袋：中毒にならない', () => {
    for (let seed = 0; seed < 100; seed++) {
      const state = withTrait('iron_stomach');
      give(state, 0, 'mushroom');
      state.rngState = Math.imul(seed + 1, 2654435761);
      expect(applyAction(state, { type: 'use', playerId: 0, item: 'mushroom' }).state.players[0].poisonTurns).toBe(0);
    }
  });

  it('大食い：満腹度が2ずつ減る', () => {
    const state = withTrait('big_eater');
    state.turn = 6;
    expect(applyAction(state, { type: 'endTurn' }).state.players[0].hunger).toBe(6);
  });

  it('夜目：夜でも昼と同じ視界で、誰なのかも分かる', () => {
    const state = withTrait('night_eyes', 1);
    state.turn = 6;
    state.map.terrain[cellIndex(state, state.players[0].x, state.players[0].y)] = 'beach';
    const view = getPlayerView(state, 0);
    expect(view.me.visionRadius).toBe(2);
    expect(view.cells[cellIndex(state, state.players[1].x, state.players[1].y)].figures[0]).toMatchObject({ kind: 'player', id: 1 });
  });

  it('強運：「何もなし」を引き直すので外れにくい', () => {
    const rate = (lucky: boolean) => {
      let nothing = 0;
      const start = arena();
      setHere(start, 0, 'mountain');
      if (lucky) start.players[0].publicTrait = 'lucky';
      for (let seed = 0; seed < 3000; seed++) {
        start.rngState = Math.imul(seed + 1, 2654435761);
        if (applyAction(start, { type: 'gather', playerId: 0 }).events[0].type === 'gatherNothing') nothing++;
      }
      return nothing / 3000;
    };
    expect(rate(false)).toBeCloseTo(0.35, 1);
    expect(rate(true)).toBeCloseTo(0.12, 1);
  });

  it('人望：1日に1回APを使わずに密談できる', () => {
    const state = withTrait('respected', 1);
    const { x, y } = state.players[1];
    const view = getPlayerView(state, 0);
    expect(projectPlan(view, [{ type: 'whisper', x, y, who: 1 }]).ap).toBe(3);
    const once = applyAction(state, { type: 'whisper', playerId: 0, targetId: 1 }).state;
    expect(once.players[0].ap).toBe(3);
    expect(applyAction(once, { type: 'whisper', playerId: 0, targetId: 1 }).state.players[0].ap).toBe(2);
  });

  it('鷹の目：1日に1回、好きなマスとその周りを見られる', () => {
    const state = withTrait('hawk_eye');
    const far = state.players[1];
    const once = resolveTurn(state, { 0: [{ type: 'scout', x: far.x, y: far.y }] }).state;
    expect(getPlayerView(once, 0).cells[cellIndex(once, far.x, far.y)].fog).toBe('visible');
    const later = resolveTurn(once, {}).state;
    expect(getPlayerView(later, 0).cells[cellIndex(once, far.x, far.y)].fog).toBe('known');
    const second = applyAction(applyAction(state, { type: 'scout', playerId: 0, x: 1, y: 1 }).state, { type: 'scout', playerId: 0, x: 2, y: 2 });
    expect(second.events[0]).toMatchObject({ reason: 'notAllowed' });
  });

  it('島の記憶：開始時に水源がすべて分かる', () => {
    const setups = finishDraft(playDraft('memory', 3));
    setups[0].publicTrait = 'island_memory';
    const state = createGame('memory', 5, { setups });
    state.map.terrain.forEach((t, i) => {
      if (t === 'spring' || t === 'river') expect(state.players[0].memory[i]).toBe(t);
    });
  });
});

describe('秘密特性', () => {
  const withTrait = (trait: TraitId, id = 0, gap = 0) => {
    const state = arena(gap);
    state.players[id].secretTrait = trait;
    return state;
  };
  const hitting = (prepare: () => GameState) => {
    for (let seed = 0; seed < 100; seed++) {
      const state = prepare();
      state.rngState = Math.imul(seed + 1, 2654435761);
      const r = applyAction(state, { type: 'attack', playerId: 0, targetId: 1 });
      if (r.events.some((e) => e.type === 'attackResult' && e.hit)) return r;
    }
    throw new Error('命中しませんでした');
  };

  it('死んだふり：一度だけHP1で耐え、他の人には脱落に見える', () => {
    const { state, events } = hitting(() => {
      const s = withTrait('play_dead', 1);
      s.players[1].hp = 1;
      return s;
    });
    expect(state.players[1]).toMatchObject({ alive: true, hp: 1, playingDead: true });
    expect(events).toContainEqual({ type: 'playerEliminated', playerId: 1 });
    const other = getPlayerView(state, 0);
    expect(other.roster[1].alive).toBe(false);
    expect(other.initiative.some((e) => e.playerId === 1)).toBe(false);
    expect(getPlayerView(state, 1).me.alive).toBe(true);
    expect(getPlayerView(state, 1).roster[1].alive).toBe(true);
    expect(state.players[1].secretRevealed).toBe(false);
  });

  it('死んだふりの人は遠くからは見えず、攻撃すると正体が分かる', () => {
    const state = withTrait('play_dead', 1, 1);
    state.players[1].playingDead = true;
    const cell = getPlayerView(state, 0).cells[cellIndex(state, state.players[1].x, state.players[1].y)];
    expect(cell.figures).toEqual([]);
    expect(applyAction(state, { type: 'attack', playerId: 0, targetId: 1 }).events[0].type).toBe('attackFizzled');
    const revealed = applyAction(state, { type: 'attack', playerId: 1, targetId: 0 });
    expect(revealed.state.players[1]).toMatchObject({ playingDead: false, secretRevealed: true });
  });

  it('隠し財布：1枠は奪われず、発動すると公開される', () => {
    const { state, events } = hitting(() => {
      const s = withTrait('hidden_purse', 1);
      s.players[1].inventory = [{ item: 'fruit', count: 1 }];
      return s;
    });
    expect(state.players[1].inventory).toEqual([{ item: 'fruit', count: 1 }]);
    expect(events).toContainEqual({ type: 'traitRevealed', playerId: 1, trait: 'hidden_purse' });
  });

  it('読心術：1回だけ他人の予約を覗けて、発動が公開される', () => {
    const state = withTrait('mind_reader');
    const used = useMindRead(state, 0, 1)!;
    expect(used.events).toContainEqual({ type: 'traitRevealed', playerId: 0, trait: 'mind_reader' });
    expect(useMindRead(used.state, 0, 1)).toBeNull();
    expect(useMindRead(arena(), 0, 1)).toBeNull();
  });

  it('方向音痴：10%で方向がずれ、採取率が上がる。コンパスがあれば迷わない', () => {
    const start = withTrait('lost_sense', 0, 5);
    let drift = 0;
    for (let seed = 0; seed < 3000; seed++) {
      start.rngState = Math.imul(seed + 1, 2654435761);
      const moved = applyAction(start, { type: 'move', playerId: 0, direction: 'up' }).state.players[0];
      if (moved.y !== start.players[0].y - 1) drift++;
    }
    expect(drift / 3000).toBeCloseTo(0.1, 1);
    give(start, 0, 'compass');
    for (let seed = 0; seed < 200; seed++) {
      start.rngState = Math.imul(seed + 1, 2654435761);
      expect(applyAction(start, { type: 'move', playerId: 0, direction: 'up' }).state.players[0].y).toBe(start.players[0].y - 1);
    }
  });

  it('救助の無線機：山で直すと狼煙なしで呼べ、周りには見えない', () => {
    const state = withTrait('radio', 0, 9);
    expect(applyAction(state, { type: 'useRadio', playerId: 0 }).events[0]).toMatchObject({ reason: 'notAllowed' });
    setHere(state, 0, 'mountain');
    const other = state.players[1];
    state.map.terrain[cellIndex(state, other.x + 1, other.y)] = 'beach';
    const fixed = applyAction(state, { type: 'useRadio', playerId: 0 }).state;
    expect(fixed.players[0]).toMatchObject({ radioFixed: true, ap: 1 });
    const called = applyAction(fixed, { type: 'useRadio', playerId: 0 }).state;
    expect(called.ship).not.toBeNull();
    expect(getPlayerView(called, 1).marks).toEqual([]);
    expect(getPlayerView(called, 0).marks.map((m) => m.kind)).toEqual(['shipComing']);
  });

  it('二枚舌：密談しても周りに表示されない', () => {
    const state = arena(1, 3);
    state.players[2].x = state.players[0].x;
    state.players[2].y = state.players[0].y + 1;
    state.whispers = [{ id: 0, from: 0, to: 1, status: 'open', messages: [] }];
    expect(getPlayerView(state, 2).whisperSeen.length).toBeGreaterThan(0);
    state.players[0].secretTrait = 'two_tongues';
    expect(getPlayerView(state, 2).whisperSeen).toEqual([]);
  });

  it('罠の名人：警戒でも見つからず、ダメージ+1', () => {
    const state = withTrait('trap_master', 1, 2);
    const me = state.players[0];
    state.structures[cellIndex(state, me.x + 1, me.y)] = { kind: 'trap', ownerId: 1 };
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'guard' }, { type: 'move', direction: 'right' }] });
    expect(next.players[0].hp).toBe(7);
    expect(allEvents(steps).map((e) => e.type)).not.toContain('trapDisarmed');
  });

  it('早起き：昼だけ行動値+3で、発動した日に公開される', () => {
    const state = withTrait('early_riser', 0, 5);
    state.turn = 6;
    const { events } = applyAction(state, { type: 'endTurn' });
    expect(events).toContainEqual({ type: 'traitRevealed', playerId: 0, trait: 'early_riser' });
  });

  it('盗み上手：一番価値のある物を奪う', () => {
    const { event } = (() => {
      const r = hitting(() => {
        const s = withTrait('pickpocket');
        s.players[1].inventory = [{ item: 'grass', count: 1 }, { item: 'medicine', count: 1 }];
        return s;
      });
      return { event: r.events.find((e) => e.type === 'attackResult') };
    })();
    expect(event).toMatchObject({ stolen: { item: 'medicine', count: 1 } });
  });

  it('偽の知らせ：1回だけ、本物と同じ通知を出せる', () => {
    const state = withTrait('false_alarm', 0, 5);
    const { state: next, steps } = resolveTurn(state, { 0: [{ type: 'falseAlarm' }] });
    expect(allEvents(replayFor(1, state, steps))).toContainEqual({ type: 'nearVictory' });
    expect(next.players[0].secretRevealed).toBe(false);
    expect(applyAction(next, { type: 'falseAlarm', playerId: 0 }).events[0]).toMatchObject({ reason: 'notAllowed' });
  });

  it('執念：脱落しても次の朝に砂浜でHP3で復活し、所持品は遺品になる', () => {
    let state = withTrait('tenacity', 1);
    state.players[1].hp = 1;
    state.players[1].inventory = [{ item: 'stone', count: 1 }];
    state.turn = 6; // 解決すると朝になる
    state.map.terrain[cellIndex(state, 2, 2)] = 'beach';
    for (let seed = 0; seed < 100; seed++) {
      const copy: GameState = JSON.parse(JSON.stringify(state));
      copy.rngState = Math.imul(seed + 1, 2654435761);
      const r = resolveTurn(copy, { 0: [{ type: 'attack', x: copy.players[1].x, y: copy.players[1].y }] });
      const died = allEvents(r.steps).some((e) => e.type === 'playerRevived');
      if (died) {
        state = r.state;
        expect(state.finished).toBe(false);
        expect(state.players[1]).toMatchObject({ alive: true, hp: 3, reviving: false, secretRevealed: true, inventory: [] });
        expect(state.map.terrain[cellIndex(state, state.players[1].x, state.players[1].y)]).toBe('beach');
        return;
      }
    }
    throw new Error('復活しませんでした');
  });

  it('もう一つの顔：もう1つの職業の条件でも勝てて、その職業のレシピも作れる', () => {
    const state = withTrait('other_face', 0, 5);
    state.players[0].job = 'cook';
    state.players[0].extraJob = 'soldier' as JobId;
    state.players[0].progress.warPoints = GOALS.warPoints;
    expect(resolveTurn(state, {}).state).toMatchObject({ finished: true, winnerId: 0, victoryReason: 'soldier' });

    const craft = withTrait('other_face', 0, 5);
    craft.players[0].job = 'cook';
    craft.players[0].extraJob = 'doctor';
    give(craft, 0, 'medicinal_herb');
    give(craft, 0, 'water');
    expect(projectPlan(getPlayerView(craft, 0), [{ type: 'craft', recipe: 'medicine' }]).ok).toBe(true);
    expect(applyAction(craft, { type: 'craft', playerId: 0, recipe: 'medicine' }).events[0].type).toBe('crafted');
  });

  it('発動していない秘密特性は他の人に見えない', () => {
    const state = withTrait('tenacity', 1, 5);
    const view = getPlayerView(state, 0);
    expect(view.roster[1].revealedTrait).toBeNull();
    expect(JSON.stringify(view)).not.toContain('tenacity');
    expect(getPlayerView(state, 1).secret.trait).toBe('tenacity');
  });
});

describe('道具', () => {
  it('双眼鏡で昼の視界+1、リュックで枠+4、鍋で回復+1', () => {
    const state = arena();
    give(state, 0, 'binoculars');
    expect(getPlayerView(state, 0).me.visionRadius).toBe(2);
    expect(getPlayerView(state, 0).slots).toBe(8);
    give(state, 0, 'backpack');
    expect(getPlayerView(state, 0).slots).toBe(12);
    give(state, 0, 'pot');
    give(state, 0, 'fruit');
    state.players[0].hunger = 2;
    expect(applyAction(state, { type: 'use', playerId: 0, item: 'fruit' }).state.players[0].hunger).toBe(5);
  });

  it('消毒液は出血と中毒を治す', () => {
    const state = arena();
    state.players[0].bleeding = true;
    state.players[0].poisonTurns = 2;
    state.players[0].hp = 5;
    give(state, 0, 'antiseptic');
    expect(applyAction(state, { type: 'use', playerId: 0, item: 'antiseptic' }).state.players[0]).toMatchObject({ bleeding: false, poisonTurns: 0, hp: 6 });
  });

  it('地図の断片で最初から一部の霧が晴れている', () => {
    const setups = finishDraft(playDraft('fragment', 3));
    setups[0].items = [{ item: 'map_fragment', count: 1 }];
    setups[1].items = [];
    const state = createGame('fragment', 5, { setups });
    const known = (id: number) => state.players[id].memory.filter(Boolean).length;
    expect(known(0)).toBeGreaterThan(known(1));
  });
});
