// 10.3 CPUプレイヤー。人間と同じ見え方（PlayerView）だけで判断し、霧の向こうは見えない。
import { ITEMS, RECIPES, TERRAIN, WATER_TERRAINS } from './data';
import type { Rng } from './rng';
import { JOBS } from './roles';
import type { Direction, JobId, PlanAction, RecipeId, TerrainId } from './types';
import { isProtected, projectPlan, type CellView, type PlayerView } from './view';

export type CpuLevel = 'easy' | 'normal' | 'hard';
export const CPU_LEVEL_NAMES: Record<CpuLevel, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

const DIRS: [Direction, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
const ATTACK_WILLINGNESS: Record<CpuLevel, number> = { easy: 0.1, normal: 0.5, hard: 1 };

/** 欲しい素材がある地形 */
const JOB_TERRAINS: Record<JobId, TerrainId[]> = {
  fisher: ['beach', 'river'],
  carpenter: ['forest', 'rock', 'grass'],
  doctor: ['grass', 'forest', 'spring', 'river'],
  soldier: ['forest', 'rock'],
  explorer: [],
  cook: ['beach', 'forest', 'grass', 'rock'],
};
const JOB_RECIPES: Record<JobId, RecipeId[]> = {
  fisher: ['fishing_rod', 'stone_knife'],
  carpenter: ['fort', 'stone_axe', 'hut'],
  doctor: ['medicine', 'bandage'],
  soldier: ['stone_axe', 'spear', 'stone_knife'],
  explorer: ['canteen', 'torch'],
  cook: ['full_course', 'canteen'],
};

const cellAt = (view: PlayerView, x: number, y: number): CellView | undefined =>
  x < 0 || y < 0 || x >= view.width || y >= view.height ? undefined : view.cells[y * view.width + x];

/** 知っているマスだけを通って、条件に合う一番近いマスへの道順を探す */
function pathTo(view: PlayerView, fromX: number, fromY: number, wanted: (cell: CellView) => boolean): Direction[] | null {
  const start = fromY * view.width + fromX;
  const previous = new Map<number, { from: number; dir: Direction }>();
  const queue = [start];
  const seen = new Set([start]);
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const cell = view.cells[current];
    if (current !== start && wanted(cell)) {
      const path: Direction[] = [];
      for (let at = current; at !== start; at = previous.get(at)!.from) path.unshift(previous.get(at)!.dir);
      return path;
    }
    // 霧の中はその先へ進まない
    if (current !== start && cell.terrain === null) continue;
    for (const [dir, dx, dy] of DIRS) {
      const next = cellAt(view, cell.x + dx, cell.y + dy);
      if (!next) continue;
      const index = next.y * view.width + next.x;
      if (seen.has(index)) continue;
      if (next.terrain && TERRAIN[next.terrain].moveCost === null) continue;
      seen.add(index);
      previous.set(index, { from: current, dir });
      queue.push(index);
    }
  }
  return null;
}

export function planForCpu(view: PlayerView, level: CpuLevel, rng: Rng): PlanAction[] {
  if (!view.me.alive) return [];
  const plan: PlanAction[] = [];
  const add = (action: PlanAction) => {
    if (!projectPlan(view, [...plan, action]).ok) return false;
    plan.push(action);
    return true;
  };
  const here = () => projectPlan(view, plan);
  const has = (item: string) => view.me.inventory.some((s) => s.item === item);
  const job = view.roster.find((p) => p.id === view.me.id)?.job ?? null;

  const walk = (wanted: (cell: CellView) => boolean) => {
    const from = here();
    const path = pathTo(view, from.x, from.y, wanted);
    if (!path) return false;
    let moved = false;
    for (const direction of path) {
      if (!add({ type: 'move', direction })) break;
      moved = true;
    }
    return moved;
  };
  const gatherAll = () => {
    while (add({ type: 'gather' })) {
      if (plan.length > 8) break;
    }
  };

  // ①生存。回復できるものは使う
  if (view.me.bleeding && has('bandage')) add({ type: 'use', item: 'bandage' });
  if (view.me.hp <= 4 && has('medicine')) add({ type: 'use', item: 'medicine' });
  if (view.me.hunger <= 5) {
    const food = view.me.inventory.find((s) => ITEMS[s.item].use?.food && s.item !== 'mushroom');
    if (food) add({ type: 'use', item: food.item });
  }
  if (view.me.water <= 5 && has('water')) add({ type: 'use', item: 'water' });

  const fromCell = () => cellAt(view, here().x, here().y)!;
  const isWater = (cell: CellView) => !!cell.terrain && WATER_TERRAINS.includes(cell.terrain);

  // 最終局面は高いところへ逃げて、人がいれば戦う
  if (view.finalPhase) {
    const sinking = new Set(view.marks.filter((m) => m.kind === 'sink').map((m) => m.y * view.width + m.x));
    if (sinking.has(fromCell().y * view.width + fromCell().x)) {
      walk((cell) => !sinking.has(cell.y * view.width + cell.x) && !!cell.terrain && cell.terrain !== 'sea');
    }
  }

  // 喉が渇いたら水場へ。水場にいれば飲む
  if (view.me.water <= 4) {
    if (isWater(fromCell())) gatherAll();
    else if (walk(isWater) && isWater(fromCell())) add({ type: 'gather' });
  }
  if (view.me.hp <= 3 && !view.finalPhase) {
    add({ type: 'rest' });
    return plan;
  }

  // ③勝てそうなら攻撃する
  const others = view.cells.flatMap((cell) =>
    cell.figures.flatMap((figure) =>
      figure.kind === 'player' ? [{ cell, who: figure.id as number | undefined }] : figure.kind === 'shadow' ? [{ cell, who: undefined }] : [],
    ),
  );
  const willing = view.finalPhase ? 1 : ATTACK_WILLINGNESS[level];
  if (others.length > 0 && !isProtected(view) && view.me.hp >= 4 && rng.next() < willing) {
    const target = others[0];
    add({ type: 'attack', x: target.cell.x, y: target.cell.y, ...(target.who === undefined ? {} : { who: target.who }) });
  }

  if (job) {
    // ②自分の勝利条件を進める
    if (has('full_course')) add({ type: 'use', item: 'full_course' });
    if (job === 'doctor') {
      for (const other of others) {
        if (other.cell.x === here().x && other.cell.y === here().y) {
          add({ type: 'heal', x: other.cell.x, y: other.cell.y, ...(other.who === undefined ? {} : { who: other.who }) });
        }
      }
    }
    if (job === 'carpenter' && fromCell().structure === 'fort') add({ type: 'repair' });
    for (const recipe of JOB_RECIPES[job]) {
      if (!RECIPES[recipe].job || RECIPES[recipe].job === job) add({ type: 'craft', recipe });
    }
    // 特殊マスは探検家の条件にも採取にも役立つ
    if (job === 'explorer') {
      walk((cell) => cell.terrain === null);
    } else if (JOB_TERRAINS[job].includes(fromCell().terrain as TerrainId)) {
      gatherAll();
    } else {
      walk((cell) => !!cell.terrain && JOB_TERRAINS[job].includes(cell.terrain));
    }
  }

  // ④残りは探索と採取
  if (here().ap > 0) walk((cell) => cell.terrain === null);
  if (here().ap > 0) gatherAll();
  return plan;
}

/** 幽霊のCPU：祟れるなら祟り、ときどき誰かの周りに霧を出す */
export function ghostPlanForCpu(view: PlayerView, rng: Rng): PlanAction[] {
  if (!view.ghost) return [];
  const plan: PlanAction[] = [];
  if (view.ghost.curseReady) plan.push({ type: 'curse' });
  const seen = view.cells.filter((cell) => cell.figures.length > 0);
  if (view.ghost.hauntReady && seen.length > 0 && rng.next() < 0.5) {
    const cell = rng.pick(seen);
    plan.push({ type: 'haunt', kind: 'fog', x: cell.x, y: cell.y });
  }
  return plan;
}

export const cpuGoalName = (job: JobId) => JOBS[job].goal;
