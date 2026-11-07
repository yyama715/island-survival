// 4.1 キャラ選択。特性の配布 → 引き直し → 職業ドラフト → 所持品 → 初期位置 の順に進む。
import { generateMap } from './mapgen';
import { hashSeed, Rng } from './rng';
import { JOB_IDS, JOBS, PUBLIC_TRAITS, RARITY_ORDER, RARITY_WEIGHTS, SECRET_TRAITS, TRAITS } from './roles';
import type { ItemStack, JobId, MapSize, PlayerSetup, Point, Rarity, TraitId } from './types';

export type DraftPhase = 'reroll' | 'job' | 'items' | 'start' | 'done';

interface DraftSeat {
  publicTrait: TraitId;
  secretTrait: TraitId;
  rerolled: boolean;
  /** 引き直しを確定したか */
  rerollDone: boolean;
  job: JobId | null;
  items: number[] | null;
  start: number | null;
  /** 秘密特性がコモンだった人への補償（本人にしか見えない） */
  bonusItem: ItemStack | null;
  extraJob: JobId | null;
}

export interface DraftState {
  seed: string;
  playerCount: number;
  mapSize: MapSize;
  rngState: number;
  phase: DraftPhase;
  seats: DraftSeat[];
  /** 職業を選ぶ順 */
  order: number[];
  /** 今選んでいる順番 */
  cursor: number;
  starts: Point[];
  width: number;
}

const BONUS_ITEMS: ItemStack[] = [
  { item: 'bandage', count: 1 },
  { item: 'fruit', count: 2 },
  { item: 'wood', count: 2 },
  { item: 'stone', count: 2 },
];

function drawTrait(rng: Rng, pool: readonly TraitId[], taken: Set<TraitId>): TraitId {
  const open = pool.filter((id) => !taken.has(id));
  const rarities = RARITY_ORDER.filter((rarity) => open.some((id) => TRAITS[id].rarity === rarity));
  const total = rarities.reduce((sum, rarity) => sum + RARITY_WEIGHTS[rarity], 0);
  let roll = rng.next() * total;
  let rarity: Rarity = rarities[0];
  for (const candidate of rarities) {
    rarity = candidate;
    roll -= RARITY_WEIGHTS[candidate];
    if (roll < 0) break;
  }
  const trait = rng.pick(open.filter((id) => TRAITS[id].rarity === rarity));
  taken.add(trait);
  return trait;
}

function usedTraits(state: DraftState): Set<TraitId> {
  return new Set(state.seats.flatMap((seat) => [seat.publicTrait, seat.secretTrait]));
}

export function createDraft(seed: string, playerCount: number, seats: number, mapSize: MapSize = 'small'): DraftState {
  // 島はゲームと同じシードから作る。乱数は別に分ける
  const map = generateMap(new Rng(hashSeed(`${seed}`)), playerCount, mapSize);
  const rng = new Rng(hashSeed(`${seed}#draft`));
  const taken = new Set<TraitId>();
  const list: DraftSeat[] = Array.from({ length: seats }, () => {
    const secretTrait = drawTrait(rng, SECRET_TRAITS, taken);
    return {
      publicTrait: drawTrait(rng, PUBLIC_TRAITS, taken),
      secretTrait,
      rerolled: false,
      rerollDone: false,
      job: null,
      items: null,
      start: null,
      bonusItem: TRAITS[secretTrait].rarity === 'common' ? rng.pick(BONUS_ITEMS) : null,
      extraJob: null,
    };
  });
  return {
    seed,
    playerCount,
    mapSize,
    rngState: rng.state,
    phase: 'reroll',
    seats: list,
    order: [],
    cursor: 0,
    starts: map.starts,
    width: map.width,
  };
}

const clone = (state: DraftState): DraftState => JSON.parse(JSON.stringify(state));

/** 公開特性のレア度が低い人から。同じならランダム。秘密特性は混ぜない（推測されないように） */
function fixOrder(state: DraftState, rng: Rng) {
  const rank = (seat: number) => RARITY_ORDER.indexOf(TRAITS[state.seats[seat].publicTrait].rarity);
  state.order = rng
    .shuffled(state.seats.map((_, i) => i))
    .sort((a, b) => rank(a) - rank(b));
  state.cursor = 0;
}

/** 引き直すなら公開特性を配り直す。初期所持品が1つ減る */
export function draftReroll(previous: DraftState, seat: number, reroll: boolean): DraftState | null {
  if (previous.phase !== 'reroll' || previous.seats[seat]?.rerollDone) return null;
  const state = clone(previous);
  const rng = new Rng(state.rngState);
  const me = state.seats[seat];
  if (reroll) {
    const taken = usedTraits(state);
    me.publicTrait = drawTrait(rng, PUBLIC_TRAITS, taken);
    me.rerolled = true;
  }
  me.rerollDone = true;
  if (state.seats.every((s) => s.rerollDone)) {
    fixOrder(state, rng);
    state.phase = 'job';
  }
  state.rngState = rng.state;
  return state;
}

export function draftPickJob(previous: DraftState, seat: number, job: JobId): DraftState | null {
  if (previous.phase !== 'job' || previous.order[previous.cursor] !== seat) return null;
  if (!Object.hasOwn(JOBS, job) || previous.seats.some((s) => s.job === job)) return null;
  const state = clone(previous);
  state.seats[seat].job = job;
  state.cursor += 1;
  if (state.cursor >= state.seats.length) {
    // もう一つの顔：誰も選ばなかった職業から1つ
    const rng = new Rng(state.rngState);
    const left = JOB_IDS.filter((id) => !state.seats.some((s) => s.job === id));
    for (const s of state.seats) {
      if (s.secretTrait === 'other_face' && left.length > 0) s.extraJob = rng.pick(left);
    }
    state.rngState = rng.state;
    state.phase = 'items';
    state.cursor = 0;
  }
  return state;
}

/** 選べる個数。候補3つから2つ。引き直した人は1つ減る。候補が足りない職業は全部 */
export function itemAllowance(state: DraftState, seat: number): number {
  const me = state.seats[seat];
  if (!me.job) return 0;
  return Math.max(0, Math.min(2, JOBS[me.job].items.length) - (me.rerolled ? 1 : 0));
}

export function draftPickItems(previous: DraftState, seat: number, indexes: number[]): DraftState | null {
  if (previous.phase !== 'items') return null;
  const me = previous.seats[seat];
  if (!me?.job || me.items) return null;
  const options = JOBS[me.job].items.length;
  const unique = new Set(indexes);
  const valid =
    Array.isArray(indexes) &&
    indexes.length === itemAllowance(previous, seat) &&
    unique.size === indexes.length &&
    indexes.every((i) => Number.isInteger(i) && i >= 0 && i < options);
  if (!valid) return null;
  const state = clone(previous);
  state.seats[seat].items = indexes;
  if (state.seats.every((s) => s.items)) {
    state.phase = 'start';
    state.cursor = 0;
    state.order = [...state.order].reverse();
  }
  return state;
}

/** 初期位置はドラフトの逆順で選ぶ */
export function draftPickStart(previous: DraftState, seat: number, start: number): DraftState | null {
  if (previous.phase !== 'start' || previous.order[previous.cursor] !== seat) return null;
  if (!Number.isInteger(start) || !previous.starts[start] || previous.seats.some((s) => s.start === start)) return null;
  const state = clone(previous);
  state.seats[seat].start = start;
  state.cursor += 1;
  if (state.cursor >= state.seats.length) state.phase = 'done';
  return state;
}

/** 時間切れの人の分を、今の段階で自動的に決める */
export function draftAuto(previous: DraftState): DraftState {
  let state = previous;
  const rng = new Rng(state.rngState);
  if (state.phase === 'reroll') {
    for (let seat = 0; seat < state.seats.length; seat++) {
      if (!state.seats[seat].rerollDone) state = draftReroll(state, seat, false) ?? state;
    }
  } else if (state.phase === 'job') {
    const seat = state.order[state.cursor];
    const open = JOB_IDS.filter((id) => !state.seats.some((s) => s.job === id));
    state = draftPickJob(state, seat, rng.pick(open)) ?? state;
  } else if (state.phase === 'items') {
    for (let seat = 0; seat < state.seats.length; seat++) {
      if (state.seats[seat].items) continue;
      const allowance = itemAllowance(state, seat);
      state = draftPickItems(state, seat, Array.from({ length: allowance }, (_, i) => i)) ?? state;
    }
  } else if (state.phase === 'start') {
    const seat = state.order[state.cursor];
    const open = state.starts.map((_, i) => i).filter((i) => !state.seats.some((s) => s.start === i));
    state = draftPickStart(state, seat, rng.pick(open)) ?? state;
  }
  return state;
}

export function finishDraft(state: DraftState): PlayerSetup[] {
  return state.seats.map((seat) => {
    const items = (seat.items ?? []).map((i) => ({ ...JOBS[seat.job!].items[i] }));
    if (seat.bonusItem) items.push({ ...seat.bonusItem });
    return {
      job: seat.job!,
      publicTrait: seat.publicTrait,
      secretTrait: seat.secretTrait,
      ...(seat.extraJob ? { extraJob: seat.extraJob } : {}),
      items,
      start: seat.start!,
    };
  });
}

export interface DraftView {
  phase: DraftPhase;
  /** 自分の席 */
  you: number;
  publicTrait: TraitId;
  secretTrait: TraitId;
  bonusItem: ItemStack | null;
  extraJob: JobId | null;
  rerolled: boolean;
  rerollDone: boolean;
  itemsDone: boolean;
  allowance: number;
  /** 全員に公開される情報 */
  seats: { id: number; publicTrait: TraitId; job: JobId | null; rerollDone: boolean; itemsDone: boolean; start: number | null }[];
  /** 今選ぶ番の席 */
  turnSeat: number | null;
  starts: { index: number; label: string; taken: boolean }[];
}

/** 砂浜の場所を、地図の見えないプレイヤーにも分かる言葉にする */
function startLabel(point: Point, width: number): string {
  const center = (width - 1) / 2;
  const third = width / 6;
  const ns = point.y < center - third ? '北' : point.y > center + third ? '南' : '';
  const ew = point.x < center - third ? '西' : point.x > center + third ? '東' : '';
  return `${ns}${ew || (ns ? '' : '中央')}の砂浜`;
}

export function getDraftView(state: DraftState, seat: number): DraftView {
  const me = state.seats[seat];
  const picking = state.phase === 'job' || state.phase === 'start';
  return {
    phase: state.phase,
    you: seat,
    publicTrait: me.publicTrait,
    secretTrait: me.secretTrait,
    bonusItem: me.bonusItem,
    extraJob: me.extraJob,
    rerolled: me.rerolled,
    rerollDone: me.rerollDone,
    itemsDone: !!me.items,
    allowance: itemAllowance(state, seat),
    seats: state.seats.map((s, id) => ({
      id,
      publicTrait: s.publicTrait,
      job: s.job,
      rerollDone: s.rerollDone,
      itemsDone: !!s.items,
      start: s.start,
    })),
    turnSeat: picking ? state.order[state.cursor] ?? null : null,
    starts: state.starts.map((point, index) => ({
      index,
      label: `${startLabel(point, state.width)}（候補${index + 1}）`,
      taken: state.seats.some((s) => s.start === index),
    })),
  };
}
