// プレイヤーごとの見え方。画面へ送るのはこの結果だけにする（10.2 霧の不正閲覧を防ぐ）。
import {
  AMBUSH_AP,
  ATTACK_AP,
  BOTTLE_ITEM,
  EARLY_PROTECTION_TURNS,
  GATHER_AP,
  GUARD_AP,
  HIDE_AP,
  INVENTORY_SLOTS,
  ITEMS,
  LETTER,
  LETTER_AP,
  MAX_PLAN_ACTIONS,
  RECIPES,
  STACK_SIZE,
  TERRAIN,
  THROW_ITEM,
  WHISPER_AP,
} from './data';
import { cellIndex, dayOf, hasItem, isWeak, phaseOf, visibleCells, visionRadius } from './game';
import type {
  Direction,
  GameEvent,
  GameState,
  InitiativeEntry,
  ItemId,
  ItemStack,
  Phase,
  PlanAction,
  ResolutionStep,
  StructureKind,
  TerrainId,
} from './types';

export type Fog = 'unknown' | 'known' | 'visible';

export type Figure =
  | { kind: 'self'; id: number; name: string }
  | { kind: 'player'; id: number; name: string }
  /** 夜の人影。誰なのかは分からない */
  | { kind: 'shadow' };

export interface CellView {
  x: number;
  y: number;
  fog: Fog;
  terrain: TerrainId | null;
  /** 視界内で昼のときだけ分かる枯渇度 */
  depletion: number | null;
  /** 視界内で昼のときだけ分かる遺品の有無 */
  relic: boolean;
  /** 小屋は視界内なら見える。罠は置いた本人にだけ見える */
  structure: StructureKind | null;
  figures: Figure[];
}

export interface WhisperView {
  id: number;
  /** 自分が頼まれた側か */
  incoming: boolean;
  status: 'pending' | 'open' | 'refused';
  /** 相手。夜は誰なのか分からない */
  withId: number | null;
  messages: { mine: boolean; text: string }[];
}

export interface PlayerView {
  width: number;
  height: number;
  turn: number;
  day: number;
  phase: Phase;
  cells: CellView[];
  me: {
    id: number;
    name: string;
    x: number;
    y: number;
    hp: number;
    ap: number;
    alive: boolean;
    inventory: ItemStack[];
    dryStreak: number;
    terrain: TerrainId;
    visionRadius: number;
    hunger: number;
    water: number;
    poisoned: boolean;
    bleeding: boolean;
    tired: boolean;
    weak: boolean;
    hidden: boolean;
  };
  /** 自分のマスに置かれた手紙 */
  letters: string[];
  whispers: WhisperView[];
  /** 6.1 視界の中で「ひそひそ話している」2人のマス */
  whisperSeen: { x: number; y: number }[];
  /** 全プレイヤーの公開情報（職業の公開はマイルストーン4で追加） */
  roster: { id: number; name: string; alive: boolean }[];
  /** 8.1 全員分の行動順と行動値は計画フェーズの前に公開する */
  initiative: InitiativeEntry[];
  finished: boolean;
  winnerId: number | null;
}

export function getPlayerView(state: GameState, playerId: number): PlayerView {
  const me = state.players[playerId];
  const { width, height } = state.map;
  const phase = phaseOf(state.turn);
  const visible = new Set(me.alive ? visibleCells(state, me) : []);

  const cells: CellView[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const isVisible = visible.has(index);
      const remembered = me.memory[index];
      const figures: Figure[] = [];
      if (isVisible) {
        for (const other of state.players) {
          if (!other.alive || other.x !== x || other.y !== y) continue;
          if (other.id === me.id) figures.push({ kind: 'self', id: other.id, name: other.name });
          // 隠れている人は同じマスにいるときしか見えない
          else if (other.hidden && (other.x !== me.x || other.y !== me.y)) continue;
          // 3.3 松明を持つ人は夜でも誰なのか分かる
          else if (phase === 'night' && !hasItem(other, 'torch')) figures.push({ kind: 'shadow' });
          else figures.push({ kind: 'player', id: other.id, name: other.name });
        }
      }
      const structure = state.structures[index];
      const seesStructure = isVisible && structure && (structure.kind !== 'trap' || structure.ownerId === me.id);
      cells.push({
        x,
        y,
        fog: isVisible ? 'visible' : remembered ? 'known' : 'unknown',
        terrain: isVisible ? state.map.terrain[index] : remembered,
        depletion: isVisible && phase === 'day' ? state.depletion[index] : null,
        relic: isVisible && phase === 'day' && !!state.relics[index],
        structure: seesStructure ? structure.kind : null,
        figures,
      });
    }
  }

  const terrainHere = state.map.terrain[cellIndex(state, me.x, me.y)];
  const whispers: WhisperView[] = state.whispers
    .filter((w) => w.from === me.id || w.to === me.id)
    .map((w) => ({
      id: w.id,
      incoming: w.to === me.id,
      status: w.status,
      withId: phase === 'night' ? null : w.from === me.id ? w.to : w.from,
      messages: w.messages.map((m) => ({ mine: m.from === me.id, text: m.text })),
    }));
  const whisperSeen = state.whispers.flatMap((w) => {
    if (w.status !== 'open' || w.from === me.id || w.to === me.id) return [];
    const a = state.players[w.from];
    const b = state.players[w.to];
    const seesBoth =
      visible.has(cellIndex(state, a.x, a.y)) && visible.has(cellIndex(state, b.x, b.y)) && !a.hidden && !b.hidden;
    return seesBoth ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [];
  });

  return {
    width,
    height,
    turn: state.turn,
    day: dayOf(state.turn),
    phase,
    cells,
    me: {
      id: me.id,
      name: me.name,
      x: me.x,
      y: me.y,
      hp: me.hp,
      ap: me.ap,
      alive: me.alive,
      inventory: me.inventory.map((s) => ({ ...s })),
      dryStreak: me.dryStreak,
      terrain: terrainHere,
      visionRadius: visionRadius(terrainHere, phase, hasItem(me, 'torch')),
      hunger: me.hunger,
      water: me.water,
      poisoned: me.poisonTurns > 0,
      bleeding: me.bleeding,
      tired: me.tired,
      weak: isWeak(me),
      hidden: me.hidden,
    },
    letters: me.alive ? (state.letters[cellIndex(state, me.x, me.y)] ?? []).map((l) => l.text) : [],
    whispers,
    whisperSeen,
    roster: state.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive })),
    initiative: state.initiative.map((entry) => ({ ...entry })),
    finished: state.finished,
    winnerId: state.winnerId,
  };
}

const DIRECTION_DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export interface PlanProjection {
  ok: boolean;
  /** 予約どおりに進んだときの現在地と残りAP（霧の中のコストは最低の1で数える） */
  x: number;
  y: number;
  ap: number;
  /** 霧の中へ進む予約を含む（着くまで本当のコストは分からない） */
  uncertain: boolean;
  /** 予約を全部実行したあとに持っている見込み（採取の結果は含まない） */
  owned: Partial<Record<ItemId, number>>;
}

/**
 * 予約の見込みを計算する。本人が知っている地形だけを使うので、画面にもサーバーの検証にも同じものが使える。
 * 知っている範囲で明らかに無理な予約（海へ進む、APが足りない）は ok: false になる。
 */
export function projectPlan(view: PlayerView, plan: readonly PlanAction[]): PlanProjection {
  let { x, y, ap } = view.me;
  let uncertain = false;
  let ok = view.me.alive && plan.length <= MAX_PLAN_ACTIONS;
  let attacks = 0;
  let moved = false;
  let ambushes = 0;
  const owned = new Map<ItemId, number>();
  for (const stack of view.me.inventory) owned.set(stack.item, (owned.get(stack.item) ?? 0) + stack.count);
  const spend = (item: ItemId, count: number) => {
    const left = (owned.get(item) ?? 0) - count;
    owned.set(item, left);
    if (left < 0) ok = false;
  };
  const add = (item: ItemId, count: number) => owned.set(item, (owned.get(item) ?? 0) + count);
  const terrainAt = (px: number, py: number) => view.cells[py * view.width + px]?.terrain ?? null;

  for (const action of plan) {
    if (action.type === 'gather') {
      ap -= GATHER_AP;
    } else if (action.type === 'attack') {
      ap -= ATTACK_AP;
      attacks += 1;
      if (attacks > 1 || ambushes > 0 || !canTarget(view, action)) ok = false;
      if (action.throwStone && action.useBottle) ok = false;
      if (action.throwStone) {
        if (view.phase === 'night') ok = false;
        spend(THROW_ITEM, 1);
      }
      if (action.useBottle) spend(BOTTLE_ITEM, 1);
    } else if (action.type === 'discard') {
      spend(action.item, 1);
    } else if (action.type === 'use') {
      if (!ITEMS[action.item].use) ok = false;
      spend(action.item, 1);
      const leaves = ITEMS[action.item].use?.leaves;
      if (leaves) add(leaves, 1);
    } else if (action.type === 'craft') {
      const recipe = RECIPES[action.recipe];
      if (!recipe) {
        ok = false;
        continue;
      }
      ap -= recipe.ap;
      const inputs = recipe.inputs.find((set) => set.every(({ item, count }) => (owned.get(item) ?? 0) >= count));
      if (!inputs) ok = false;
      else for (const { item, count } of inputs) spend(item, count);
      if (recipe.output) add(recipe.output.item, recipe.output.count);
      if (recipe.builds && view.cells[y * view.width + x].structure) ok = false;
      if (recipe.output && slotsNeeded(owned) > INVENTORY_SLOTS) ok = false;
    } else if (action.type === 'rest') {
      if (ap <= 0) ok = false;
      ap = 0;
    } else if (action.type === 'guard') {
      ap -= GUARD_AP;
    } else if (action.type === 'hide') {
      ap -= HIDE_AP;
      const here = terrainAt(x, y);
      if (here && !TERRAIN[here].canHide) ok = false;
    } else if (action.type === 'ambush') {
      ap -= AMBUSH_AP;
      ambushes += 1;
      // 待ち伏せは「今いるマス」に入ってきた人を狙うので、動く予約とは一緒にできない
      if (ambushes > 1 || moved || attacks > 0 || isProtected(view)) ok = false;
    } else if (action.type === 'letter') {
      ap -= LETTER_AP;
      if (!action.text.trim()) ok = false;
      spend(LETTER.material, 1);
    } else if (action.type === 'whisper') {
      ap -= WHISPER_AP;
      if (!canTarget({ ...view, turn: Math.max(view.turn, EARLY_PROTECTION_TURNS + 1) }, action)) ok = false;
    } else {
      moved = true;
      if (ambushes > 0) ok = false;
      const [dx, dy] = DIRECTION_DELTA[action.direction];
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= view.width || ny >= view.height) {
        ok = false;
        continue;
      }
      const known = view.cells[ny * view.width + nx].terrain;
      if (known === null) uncertain = true;
      const cost = known === null ? 1 : TERRAIN[known].moveCost;
      if (cost === null) {
        ok = false;
        continue;
      }
      ap -= cost;
      x = nx;
      y = ny;
    }
    if (ap < 0) ok = false;
  }
  return { ok, x, y, ap, uncertain, owned: Object.fromEntries(owned) };
}

export const isProtected = (view: PlayerView) => view.turn <= EARLY_PROTECTION_TURNS;

function slotsNeeded(owned: Map<ItemId, number>): number {
  let slots = 0;
  for (const count of owned.values()) slots += Math.ceil(Math.max(0, count) / STACK_SIZE);
  return slots;
}

/** 計画のときに見えている相手だけを狙える。昼は本人を指定し、夜は人影のいるマスを指定する */
function canTarget(view: PlayerView, action: { x: number; y: number; who?: number }): boolean {
  if (isProtected(view)) return false;
  const cell = view.cells[action.y * view.width + action.x];
  if (!cell || cell.x !== action.x) return false;
  if (action.who !== undefined) {
    return cell.figures.some((figure) => figure.kind === 'player' && figure.id === action.who);
  }
  return cell.figures.some((figure) => figure.kind === 'shadow');
}

export interface ReplayStep {
  events: GameEvent[];
  /** 見え方が変わるコマにだけ付ける */
  view?: PlayerView;
}

/**
 * 解決フェーズの記録を、1人のプレイヤーに見せてよい形へ絞り込む。
 * 自分の行動は全部、他の人の行動は視界に入った移動と公開の出来事だけ。
 */
export function replayFor(viewerId: number, previous: GameState, steps: readonly ResolutionStep[]): ReplayStep[] {
  const replay: ReplayStep[] = [];
  let before = previous;

  for (const step of steps) {
    const after = step.state;
    const viewer = after.players[viewerId];
    const events: GameEvent[] = [];
    let changed = false;

    for (const event of step.events) {
      switch (event.type) {
        case 'actorTurn':
        case 'playerEliminated':
        case 'gameFinished':
          events.push(event);
          changed ||= event.type !== 'actorTurn';
          break;
        case 'turnStarted':
          events.push(event);
          changed = true;
          break;
        case 'moved':
          if (event.playerId === viewerId) {
            events.push(event);
            changed = true;
          } else if (viewer.alive) {
            const mover = before.players[event.playerId];
            const seen = new Set(visibleCells(after, viewer));
            const width = after.map.width;
            if (seen.has(event.y * width + event.x) || seen.has(mover.y * width + mover.x)) {
              const night = phaseOf(after.turn) === 'night';
              events.push({ type: 'sighted', who: night ? null : event.playerId, x: event.x, y: event.y });
              changed = true;
            }
          }
          break;
        case 'attackResult': {
          const night = phaseOf(after.turn) === 'night';
          const show = (id: number | null) => (night && id !== viewerId ? null : id);
          if (event.attackerId === viewerId || event.targetId === viewerId) {
            events.push({ ...event, attackerId: show(event.attackerId), targetId: show(event.targetId) });
            changed = true;
          } else if (viewer.alive && visibleCells(after, viewer).includes(event.y * after.map.width + event.x)) {
            events.push({
              type: 'combatSeen',
              attackerId: show(event.attackerId),
              targetId: show(event.targetId),
              x: event.x,
              y: event.y,
            });
            changed = true;
          }
          break;
        }
        // 手番と関係なく本人にだけ届くもの
        case 'statusDamage':
        case 'bleedStopped':
        case 'foundOut':
        case 'spotted':
        case 'trapSprung':
        case 'whisperFailed':
          if (event.playerId === viewerId) {
            events.push(event);
            changed = true;
          }
          break;
        default:
          if (step.actorId === viewerId) {
            events.push(event);
            changed = true;
          }
      }
    }

    if (events.length > 0) {
      replay.push(changed ? { events, view: getPlayerView(after, viewerId) } : { events });
    }
    before = after;
  }
  return replay;
}
