// プレイヤーごとの見え方。画面へ送るのはこの結果だけにする（10.2 霧の不正閲覧を防ぐ）。
import { ATTACK_AP, EARLY_PROTECTION_TURNS, GATHER_AP, MAX_PLAN_ACTIONS, TERRAIN } from './data';
import { cellIndex, dayOf, phaseOf, visibleCells, visionRadius } from './game';
import type {
  Direction,
  GameEvent,
  GameState,
  InitiativeEntry,
  ItemStack,
  Phase,
  PlanAction,
  ResolutionStep,
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
  figures: Figure[];
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
  };
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
          else if (phase === 'night') figures.push({ kind: 'shadow' });
          else figures.push({ kind: 'player', id: other.id, name: other.name });
        }
      }
      cells.push({
        x,
        y,
        fog: isVisible ? 'visible' : remembered ? 'known' : 'unknown',
        terrain: isVisible ? state.map.terrain[index] : remembered,
        depletion: isVisible && phase === 'day' ? state.depletion[index] : null,
        relic: isVisible && phase === 'day' && !!state.relics[index],
        figures,
      });
    }
  }

  const terrainHere = state.map.terrain[cellIndex(state, me.x, me.y)];
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
      visionRadius: visionRadius(terrainHere, phase),
    },
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
  const owned = new Map(view.me.inventory.map((stack) => [stack.item, stack.count]));

  for (const action of plan) {
    if (action.type === 'gather') {
      ap -= GATHER_AP;
    } else if (action.type === 'attack') {
      ap -= ATTACK_AP;
      attacks += 1;
      if (attacks > 1 || !canTarget(view, action)) ok = false;
    } else if (action.type === 'discard') {
      const left = (owned.get(action.item) ?? 0) - 1;
      owned.set(action.item, left);
      if (left < 0) ok = false;
    } else {
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
  return { ok, x, y, ap, uncertain };
}

export const isProtected = (view: PlayerView) => view.turn <= EARLY_PROTECTION_TURNS;

/** 計画のときに見えている相手だけを狙える。昼は本人を指定し、夜は人影のいるマスを指定する */
function canTarget(view: PlayerView, action: Extract<PlanAction, { type: 'attack' }>): boolean {
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
