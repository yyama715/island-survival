// 10.3 CPUプレイヤー。人間と同じ見え方（PlayerView）だけで判断し、霧の向こうは見えない。
import { ITEMS, TERRAIN, WATER_TERRAINS, WEAPONS } from './data';
import type { Rng } from './rng';
import { FOOD_GENRES, ITEM_GENRE, JOBS, type FoodGenre } from './roles';
import type { Direction, ItemId, JobId, PlanAction, TerrainId } from './types';
import { isProtected, projectPlan, type CellView, type PlayerView } from './view';

export type CpuLevel = 'easy' | 'normal' | 'hard';
export const CPU_LEVEL_NAMES: Record<CpuLevel, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

const DIRS: [Direction, number, number][] = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
const ATTACK_WILLINGNESS: Record<CpuLevel, number> = { easy: 0.1, normal: 0.5, hard: 0.9 };

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

/** 素材が取れる地形 */
const ITEM_TERRAINS: Partial<Record<ItemId, TerrainId[]>> = {
  wood: ['forest'],
  stone: ['rock', 'mountain'],
  grass: ['grass'],
  medicinal_herb: ['grass', 'forest', 'mountain'],
  flint: ['rock'],
};
const GENRE_TERRAINS: Record<FoodGenre, TerrainId[]> = {
  fish: ['beach', 'river'],
  meat: ['rock'],
  fruit: ['forest', 'grass'],
  mushroom: ['forest'],
  shell: ['beach'],
  herb: ['grass'],
};
const FOOD_TERRAINS: TerrainId[] = ['forest', 'grass', 'beach', 'rock'];
const SPECIAL_TERRAINS: TerrainId[] = ['cave', 'wreck', 'ruins'];
const FISHING: ItemId[] = ['fishing_line', 'fishing_rod'];
/** 勝利条件や狼煙に使うので捨てない */
const KEEP: ItemId[] = ['island_lord', 'wood', 'stone', 'rope', 'grass', 'nails', 'flint', 'matches', 'fishing_line', 'fishing_rod', 'medicinal_herb', 'canteen', 'backpack', 'compass'];
const LOW_WATER = 4;
const LOW_HUNGER = 3;
const EAT_BELOW = 6;
const DRINK_BELOW = 6;
const FLEE_HP = 3;
const FIGHT_HP = 4;
const WORN_OUT = 2;
/** 10日目の朝から島の真ん中へ向かう */
const GATHER_TO_CENTER_TURN = 19;
const CENTER_RADIUS = 2;
/** この日から、見えている相手を自分から狙いに行く */
const HUNT_PEOPLE_DAY = 4;
const HUNT_MIN_HP = 6;

export function planForCpu(view: PlayerView, level: CpuLevel, rng: Rng): PlanAction[] {
  if (!view.me.alive) return [];
  const plan: PlanAction[] = [];
  const add = (action: PlanAction) => {
    if (!projectPlan(view, [...plan, action]).ok) return false;
    plan.push(action);
    return true;
  };
  const here = () => projectPlan(view, plan);
  const count = (item: ItemId) => here().owned[item] ?? 0;
  const has = (item: ItemId) => count(item) > 0;
  const job = view.roster.find((p) => p.id === view.me.id)?.job ?? null;
  const roles = [job, view.secret.extraJob];
  const fromCell = () => cellAt(view, here().x, here().y)!;
  const attacked = () => plan.some((a) => a.type === 'attack');

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
    while (plan.length < 12 && add({ type: 'gather' }));
  };
  /** この地形で採取する。今いなければ近くまで歩く */
  const forage = (terrains: readonly TerrainId[]) => {
    const fresh = (cell: CellView) => !!cell.terrain && terrains.includes(cell.terrain) && (cell.depletion ?? 0) < WORN_OUT;
    if (fresh(fromCell())) {
      gatherAll();
      return true;
    }
    if (!walk(fresh)) return false;
    if (fresh(fromCell())) gatherAll();
    return true;
  };
  /** 霧を晴らしに行く。全部見えていたら、適当な場所へ歩く */
  const roam = () => {
    if (walk((cell) => cell.terrain === null)) return true;
    const land = view.cells.filter((cell) => !!cell.terrain && cell.terrain !== 'sea');
    if (land.length === 0) return false;
    const goal = rng.pick(land);
    return walk((cell) => cell.x === goal.x && cell.y === goal.y);
  };
  const isWater = (cell: CellView) => !!cell.terrain && WATER_TERRAINS.includes(cell.terrain);

  // 料理人は1つしかないジャンルの食材を残す
  const genreCount = (genre: FoodGenre | undefined) =>
    view.me.inventory.filter((s) => ITEM_GENRE[s.item] === genre).reduce((n, s) => n + s.count, 0);
  const edible = () =>
    view.me.inventory.filter((s) => ITEMS[s.item].use?.food && (s.item !== 'mushroom' || view.me.hunger <= LOW_HUNGER) && count(s.item) > 0);

  // ①生存。回復できるものは使う
  if (view.me.bleeding) {
    if (has('bandage')) add({ type: 'use', item: 'bandage' });
    else if (has('antiseptic')) add({ type: 'use', item: 'antiseptic' });
  }
  if (view.me.hp <= FIGHT_HP && has('medicine')) add({ type: 'use', item: 'medicine' });
  if (view.me.hunger <= EAT_BELOW) {
    const foods = edible();
    const spare = job === 'cook' ? foods.find((s) => genreCount(ITEM_GENRE[s.item]) > 1) : foods[0];
    const food = spare ?? (view.me.hunger <= LOW_HUNGER ? foods[0] : undefined);
    if (food) add({ type: 'use', item: food.item });
  }
  if (view.me.water <= DRINK_BELOW && has('water')) add({ type: 'use', item: 'water' });

  // 持ち物がいっぱいなら、いらない物を捨てる
  if (view.me.inventory.length >= view.slots) {
    const junk = view.me.inventory.find((s) => s.count === 1 && !ITEMS[s.item].use && !WEAPONS[s.item] && !KEEP.includes(s.item));
    if (junk) add({ type: 'discard', item: junk.item });
  }

  // 終盤は沈むマスから離れ、島の真ん中へ向かう
  if (view.finalPhase || view.turn >= GATHER_TO_CENTER_TURN) {
    const sinking = new Set(view.marks.filter((m) => m.kind === 'sink').map((m) => m.y * view.width + m.x));
    const safe = (cell: CellView) => !sinking.has(cell.y * view.width + cell.x) && !!cell.terrain && cell.terrain !== 'sea';
    const midX = (view.width - 1) / 2;
    const midY = (view.height - 1) / 2;
    const off = (cell: CellView) => Math.max(Math.abs(cell.x - midX), Math.abs(cell.y - midY));
    const at = fromCell();
    if (!safe(at) || off(at) > CENTER_RADIUS) {
      if (!walk((cell) => safe(cell) && off(cell) <= CENTER_RADIUS) && !safe(at)) walk(safe);
    }
  }

  // 喉が渇いたら水場へ
  if (view.me.water <= LOW_WATER && count('water') === 0) {
    if (isWater(fromCell()) || walk(isWater)) {
      if (isWater(fromCell())) add({ type: 'gather' });
    }
  }
  if (view.me.hp <= FLEE_HP && !view.finalPhase) {
    add({ type: 'rest' });
    return plan;
  }
  // 救助船が見えたら走る
  const ship = view.marks.find((m) => m.kind === 'ship' || m.kind === 'shipComing');
  if (ship && !(fromCell().x === ship.x && fromCell().y === ship.y)) {
    walk((cell) => cell.x === ship.x && cell.y === ship.y);
  }

  // お腹が減って食べ物がなければ探す
  if (view.me.hunger <= LOW_HUNGER && edible().length === 0) forage(FOOD_TERRAINS);

  // ③攻撃。届く相手だけを狙う
  const others = view.cells.flatMap((cell) =>
    cell.figures.flatMap((figure) =>
      figure.kind === 'player' ? [{ cell, who: figure.id as number | undefined }] : figure.kind === 'shadow' ? [{ cell, who: undefined }] : [],
    ),
  );
  const distanceTo = (cell: CellView) => Math.abs(cell.x - here().x) + Math.abs(cell.y - here().y);
  const nearest = [...others].sort((a, b) => distanceTo(a.cell) - distanceTo(b.cell))[0];
  const warlike = roles.includes('soldier');
  const willing = view.finalPhase || warlike ? 1 : ATTACK_WILLINGNESS[level];
  const fight = () => {
    if (attacked() || !nearest || isProtected(view) || view.me.hp < FIGHT_HP) return;
    if (distanceTo(nearest.cell) >= here().ap) return;
    if (rng.next() < willing) {
      add({ type: 'attack', x: nearest.cell.x, y: nearest.cell.y, ...(nearest.who === undefined ? {} : { who: nearest.who }) });
    }
  };
  if (!roles.includes('doctor')) {
    if (has('stone') && has('wood') && !view.me.inventory.some((stack) => WEAPONS[stack.item])) add({ type: 'craft', recipe: 'stone_knife' });
    const hunting = view.day >= HUNT_PEOPLE_DAY && view.me.hp >= HUNT_MIN_HP && rng.next() < willing / 2;
    if (hunting && nearest && distanceTo(nearest.cell) > 0) walk((cell) => cell === nearest.cell);
    fight();
  }
  if (attacked() && view.finalPhase) return plan;

  // ②自分の勝利条件を進める
  const seesPeople = (cell: CellView) => cell.figures.some((figure) => figure.kind !== 'self');
  for (const role of roles) {
    if (!role || attacked()) continue;
    if (role === 'cook') {
      if (has('full_course')) add({ type: 'use', item: 'full_course' });
      add({ type: 'craft', recipe: 'full_course' });
      const held = new Set(view.me.inventory.map((stack) => ITEM_GENRE[stack.item]));
      const missing = FOOD_GENRES.filter((genre) => !held.has(genre));
      if (missing.includes('fish') && !FISHING.some(has)) {
        add({ type: 'craft', recipe: 'rope' });
        add({ type: 'craft', recipe: 'fishing_rod' });
        if (!has('rope')) forage(ITEM_TERRAINS.grass!);
        else if (!has('wood')) forage(ITEM_TERRAINS.wood!);
      }
      const meat = fromCell().npcs.find((n) => n.kind === 'critter');
      if (missing.includes('meat') && meat) add({ type: 'hunt', npcId: meat.id });
      const wanted = missing.filter((genre) => genre !== 'fish' || FISHING.some(has));
      if (wanted.length > 0) forage(wanted.flatMap((genre) => GENRE_TERRAINS[genre]));
    } else if (role === 'fisher') {
      if (!FISHING.some(has)) {
        add({ type: 'craft', recipe: 'rope' });
        add({ type: 'craft', recipe: 'fishing_rod' });
        if (!has('rope')) forage(ITEM_TERRAINS.grass!);
        else if (!has('wood')) forage(ITEM_TERRAINS.wood!);
      } else if (!has('island_lord')) forage(['beach', 'river']);
    } else if (role === 'carpenter') {
      if (fromCell().structure === 'fort') {
        add({ type: 'repair' });
      } else if (!view.cells.some((cell) => cell.structure === 'fort')) {
        add({ type: 'craft', recipe: 'fort' });
        if (count('rope') < 2) add({ type: 'craft', recipe: 'rope' });
        const material = count('wood') < 8 ? 'wood' : count('stone') < 4 ? 'stone' : count('rope') < 2 ? 'grass' : null;
        if (material) forage(ITEM_TERRAINS[material]!);
      } else walk((cell) => cell.structure === 'fort');
    } else if (role === 'doctor') {
      for (const other of others) {
        if (other.cell.x === here().x && other.cell.y === here().y) {
          add({ type: 'heal', x: other.cell.x, y: other.cell.y, ...(other.who === undefined ? {} : { who: other.who }) });
        }
      }
      if (add({ type: 'craft', recipe: 'medicine' })) add({ type: 'use', item: 'medicine' });
      const castaway = fromCell().npcs.find((n) => n.kind === 'castaway' && !n.following);
      if (castaway) add({ type: 'aid', npcId: castaway.id });
      if (!walk(seesPeople) && !walk((cell) => cell.npcs.some((n) => n.kind === 'castaway' && !n.following))) {
        if (rng.next() < 0.3) forage(ITEM_TERRAINS.medicinal_herb!);
        else roam();
      }
    } else if (role === 'soldier') {
      add({ type: 'craft', recipe: 'stone_axe' });
      if (!attacked() && !walk(seesPeople)) roam();
      fight();
      const beast = fromCell().npcs.find((n) => n.kind === 'boar');
      if (beast) add({ type: 'hunt', npcId: beast.id });
    } else if (role === 'explorer') {
      if (fromCell().terrain && SPECIAL_TERRAINS.includes(fromCell().terrain as TerrainId)) add({ type: 'gather' });
      const pick = rng.next() < 0.5;
      if (!(pick && walk((cell) => !!cell.terrain && SPECIAL_TERRAINS.includes(cell.terrain) && distanceTo(cell) > 0))) {
        roam();
      }
    }
  }

  // 狼煙の材料がそろっていれば山へ
  if (here().ap > 0 && view.day >= 3 && count('wood') >= 5 && (has('flint') || has('matches')) && !roles.includes('carpenter')) {
    if (fromCell().terrain === 'mountain') add({ type: 'craft', recipe: 'smoke' });
    else walk((cell) => cell.terrain === 'mountain');
  }

  // ④残りは探索、採取、休息
  if (attacked()) return plan;
  if (here().ap > 0 && view.me.hp < view.maxHp - 3) add({ type: 'rest' });
  if (here().ap > 0) roam();
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
