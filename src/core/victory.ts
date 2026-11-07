// 2.2 と 4.5 の勝利条件。進み具合は本人にだけ見せる。
import { FOOD_GENRES, GENRE_NAMES, GOALS, ITEM_GENRE, RAFT, type FoodGenre } from './roles';
import type { GameState, ItemId, ItemStack, JobId, PlayerState, Progress, VictoryReason } from './types';

export const newProgress = (): Progress => ({
  fishCaught: 0,
  lordCaughtBefore: false,
  lordHeldTurns: 0,
  healCount: 0,
  healedBy: {},
  warPoints: 0,
  explored: [],
  specialsVisited: [],
});

export const hasRole = (player: Pick<PlayerState, 'job' | 'extraJob'>, job: JobId) =>
  player.job === job || player.extraJob === job;

export function exploreTarget(state: GameState): number {
  const land = state.map.terrain.filter((t) => t !== 'sea').length;
  return Math.ceil(land * GOALS.exploreRatio);
}

/** 持ち物の中から、フルコースに使う食材を選ぶ。足りなければ null。島の主は2ジャンル分 */
export function courseIngredients(owned: ReadonlyMap<ItemId, number>): ItemStack[] | null {
  const used: ItemStack[] = [];
  const missing = new Set<FoodGenre>(FOOD_GENRES);
  const items = [...owned.entries()].filter(([, count]) => count > 0);
  for (const [item] of items) {
    const genre = ITEM_GENRE[item];
    if (!genre || item === 'island_lord' || !missing.has(genre)) continue;
    missing.delete(genre);
    used.push({ item, count: 1 });
  }
  const allowed = FOOD_GENRES.length - GOALS.courseGenres;
  if (missing.size <= allowed) return used;
  if (missing.size <= allowed + 2 && (owned.get('island_lord') ?? 0) > 0) {
    used.push({ item: 'island_lord', count: 1 });
    return used;
  }
  return null;
}

const owns = (player: PlayerState, item: ItemId) => player.inventory.some((stack) => stack.item === item);

/** 砦の完成からの経過 */
function fortTurns(state: GameState, player: PlayerState): number | null {
  for (const structure of Object.values(state.structures)) {
    if (structure.kind === 'fort' && structure.ownerId === player.id && structure.builtTurn !== undefined) {
      return state.turn - structure.builtTurn;
    }
  }
  return null;
}

/** 勝利条件を満たした人がいれば返す。行動順の早い人を先に見る */
export function findWinner(state: GameState): { playerId: number; reason: VictoryReason } | null {
  const order = [...state.initiative.map((e) => e.playerId), ...state.players.map((p) => p.id)];
  for (const id of order) {
    const player = state.players[id];
    if (!player?.alive) continue;
    const p = player.progress;
    if (hasRole(player, 'fisher') && owns(player, 'island_lord') && p.lordHeldTurns >= GOALS.lordHoldTurns) {
      return { playerId: id, reason: 'fisher' };
    }
    if (hasRole(player, 'carpenter') && (fortTurns(state, player) ?? -1) >= GOALS.fortHoldTurns) {
      return { playerId: id, reason: 'carpenter' };
    }
    if (hasRole(player, 'doctor') && p.healCount >= GOALS.healsNeeded && state.turn >= GOALS.doctorSurviveTurn) {
      return { playerId: id, reason: 'doctor' };
    }
    if (hasRole(player, 'soldier') && p.warPoints >= GOALS.warPoints) return { playerId: id, reason: 'soldier' };
    if (
      hasRole(player, 'explorer') &&
      p.explored.length >= exploreTarget(state) &&
      p.specialsVisited.length >= GOALS.specialsNeeded
    ) {
      return { playerId: id, reason: 'explorer' };
    }
  }
  return null;
}

/** 4.5 あと1歩か。「誰かが勝利目前」の通知に使う */
export function isNearVictory(state: GameState, player: PlayerState): boolean {
  if (!player.alive) return false;
  const p = player.progress;
  if (hasRole(player, 'fisher') && owns(player, 'island_lord') && p.lordHeldTurns >= GOALS.lordHoldTurns - 1) return true;
  if (hasRole(player, 'carpenter') && (fortTurns(state, player) ?? -1) >= GOALS.fortHoldTurns - 1) return true;
  if (hasRole(player, 'doctor') && p.healCount >= GOALS.healsNeeded - 1 && state.turn >= GOALS.doctorSurviveTurn - 2) return true;
  if (hasRole(player, 'soldier') && p.warPoints >= GOALS.warPoints - 1) return true;
  if (
    hasRole(player, 'explorer') &&
    p.specialsVisited.length >= GOALS.specialsNeeded &&
    exploreTarget(state) - p.explored.length <= 3
  ) {
    return true;
  }
  if (hasRole(player, 'cook')) {
    const owned = new Map<ItemId, number>();
    for (const stack of player.inventory) owned.set(stack.item, (owned.get(stack.item) ?? 0) + stack.count);
    if (owned.get('full_course') || courseIngredients(owned)) return true;
  }
  for (const structure of Object.values(state.structures)) {
    if (structure.kind !== 'raft' || structure.ownerId !== player.id) continue;
    const done = RAFT.needs.every((need) => (structure.stock ?? []).some((s) => s.item === need.item && s.count >= need.count));
    if (done) return true;
  }
  return false;
}

export interface GoalLine {
  label: string;
  value: string;
}

/** 本人に見せる進み具合 */
export function describeProgress(state: GameState, player: PlayerState): GoalLine[] {
  const lines: GoalLine[] = [];
  const p = player.progress;
  const roles = [player.job, player.extraJob].filter(Boolean) as JobId[];
  for (const role of roles) {
    if (role === 'fisher') {
      const ceiling = p.lordCaughtBefore ? GOALS.secondLordCeiling : GOALS.lordCeiling;
      lines.push(
        owns(player, 'island_lord')
          ? { label: '島の主を持って生き延びる', value: `${p.lordHeldTurns} / ${GOALS.lordHoldTurns}ターン` }
          : { label: '釣果（この数で島の主が出る）', value: `${p.fishCaught} / ${ceiling}匹` },
      );
    } else if (role === 'carpenter') {
      const turns = fortTurns(state, player);
      lines.push({
        label: '砦を守る',
        value: turns === null ? '未完成' : `${turns} / ${GOALS.fortHoldTurns}ターン`,
      });
    } else if (role === 'doctor') {
      lines.push({ label: '治療回数', value: `${p.healCount} / ${GOALS.healsNeeded}回` });
      lines.push({ label: '7日目の朝まで', value: state.turn >= GOALS.doctorSurviveTurn ? '到達' : `あと${GOALS.doctorSurviveTurn - state.turn}ターン` });
    } else if (role === 'soldier') {
      lines.push({ label: '戦果', value: `${p.warPoints} / ${GOALS.warPoints}点` });
    } else if (role === 'explorer') {
      lines.push({ label: '踏破', value: `${p.explored.length} / ${exploreTarget(state)}マス` });
      lines.push({ label: '特殊マス', value: `${p.specialsVisited.length} / ${GOALS.specialsNeeded}か所` });
    } else if (role === 'cook') {
      const have = new Set(player.inventory.map((s) => ITEM_GENRE[s.item]).filter(Boolean));
      const held = FOOD_GENRES.filter((g) => have.has(g)).map((g) => GENRE_NAMES[g]);
      lines.push({ label: '集めた食材', value: `${held.length} / ${GOALS.courseGenres}（${held.join('、') || 'なし'}）` });
    }
  }
  return lines;
}
