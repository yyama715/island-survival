// ルール本体。applyAction は元の状態を変更せず、新しい状態と出来事を返す。
import {
  AP_PER_TURN,
  ATTACK_AP,
  CANTEEN,
  COMBAT,
  DEFAULT_AGILITY,
  DEPLETION,
  EARLY_PROTECTION_TURNS,
  FISHING_TOOLS,
  GATHER_AP,
  INITIAL_HP,
  INITIATIVE_MODIFIER,
  INVENTORY_SLOTS,
  NIGHT_GATHER_PENALTY,
  PITY_AFTER_DRY_STREAK,
  RIVER_FISH_CHANCE,
  SPECIAL_LOOT,
  SPECIAL_REPEAT_NOTHING_CHANCE,
  STACK_SIZE,
  TERRAIN,
  UNARMED,
  VISION_BASE,
  WEAPONS,
  type GatherEntry,
  type ItemRoll,
  type WeaponDef,
} from './data';
import { generateMap } from './mapgen';
import { hashSeed, Rng } from './rng';
import type {
  Action,
  ActionResult,
  Direction,
  GameEvent,
  GameState,
  InitiativeEntry,
  ItemId,
  ItemStack,
  MapSize,
  Phase,
  PlanAction,
  PlayerState,
  ResolutionStep,
  SpecialTerrainId,
  TerrainId,
  TurnResolution,
} from './types';

const DIRECTION_DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export const cellIndex = (state: GameState, x: number, y: number) => y * state.map.width + x;
export const phaseOf = (turn: number): Phase => (turn % 2 === 1 ? 'day' : 'night');
export const dayOf = (turn: number) => Math.ceil(turn / 2);

/** 3.3 視界半径。距離は隣接8マスと同じ数え方（斜めも1マス） */
export function visionRadius(terrain: TerrainId, phase: Phase): number {
  const def = TERRAIN[terrain];
  return Math.max(0, VISION_BASE + (phase === 'day' ? def.visionDay : def.visionNight));
}

/**
 * 3.3 視線が通るか。2点を結ぶ線の途中に視線を遮る地形（森）があれば通らない。
 * 線がマスの境目を通るときは、両側とも遮られている場合だけ通らない（見る向きで結果が変わらないように）。
 */
function hasLineOfSight(terrain: readonly TerrainId[], width: number, fromX: number, fromY: number, toX: number, toY: number) {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  for (let step = 1; step < steps; step++) {
    const px = fromX + ((toX - fromX) * step) / steps;
    const py = fromY + ((toY - fromY) * step) / steps;
    const xs = Number.isInteger(px) ? [px] : [Math.floor(px), Math.ceil(px)];
    const ys = Number.isInteger(py) ? [py] : [Math.floor(py), Math.ceil(py)];
    const blocked = xs.every((x) => ys.every((y) => TERRAIN[terrain[y * width + x]].blocksSight));
    if (blocked) return false;
  }
  return true;
}

export function visibleCells(state: GameState, player: PlayerState): number[] {
  const { width, height, terrain } = state.map;
  const here = terrain[cellIndex(state, player.x, player.y)];
  const radius = visionRadius(here, phaseOf(state.turn));
  const seesOver = TERRAIN[here].seesOverBlocks;
  const cells: number[] = [];
  for (let y = Math.max(0, player.y - radius); y <= Math.min(height - 1, player.y + radius); y++) {
    for (let x = Math.max(0, player.x - radius); x <= Math.min(width - 1, player.x + radius); x++) {
      if (seesOver || hasLineOfSight(terrain, width, player.x, player.y, x, y)) cells.push(y * width + x);
    }
  }
  return cells;
}

function refreshMemory(state: GameState, player: PlayerState) {
  for (const index of visibleCells(state, player)) player.memory[index] = state.map.terrain[index];
}

/** 8.1 行動値 ＝ 機敏さ ＋ 1d6 ＋ 修正。同値は機敏さ、それも同じならランダム */
function rollInitiative(players: PlayerState[], rng: Rng): InitiativeEntry[] {
  const rolled = players
    .filter((player) => player.alive)
    .map((player) => {
      const agility = DEFAULT_AGILITY;
      const badlyHurt = player.hp <= INITIAL_HP / 2 ? INITIATIVE_MODIFIER.badlyHurt : 0;
      const overloaded = isInventoryFull(player) ? INITIATIVE_MODIFIER.overloaded : 0;
      const value = agility + rng.int(1, 6) + badlyHurt + overloaded;
      return { entry: { playerId: player.id, value, agility }, tiebreak: rng.next() };
    });
  rolled.sort(
    (a, b) => b.entry.value - a.entry.value || b.entry.agility - a.entry.agility || a.tiebreak - b.tiebreak,
  );
  return rolled.map((r) => r.entry);
}

const isInventoryFull = (player: PlayerState) =>
  player.inventory.length >= INVENTORY_SLOTS && player.inventory.every((stack) => stack.count >= STACK_SIZE);

export interface CreateGameOptions {
  mapSize?: MapSize;
  /** 実際に遊ぶ人数。島の大きさは playerCount で決まり、足りない席はCPUが入るまで空く */
  seats?: number;
  names?: string[];
}

export function createGame(seed: string, playerCount: number, mapSizeOrOptions: MapSize | CreateGameOptions = 'small'): GameState {
  const options: CreateGameOptions =
    typeof mapSizeOrOptions === 'string' ? { mapSize: mapSizeOrOptions } : mapSizeOrOptions;
  const rng = new Rng(hashSeed(`${seed}`));
  const map = generateMap(rng, playerCount, options.mapSize ?? 'small');
  const cellCount = map.width * map.height;
  const players: PlayerState[] = map.starts.slice(0, options.seats ?? playerCount).map((start, id) => ({
    id,
    name: options.names?.[id] ?? `P${id + 1}`,
    x: start.x,
    y: start.y,
    hp: INITIAL_HP,
    ap: AP_PER_TURN,
    alive: true,
    inventory: [],
    memory: new Array(cellCount).fill(null),
    dryStreak: 0,
    nestBonus: false,
    attackedOnTurn: 0,
  }));
  const initiative = rollInitiative(players, rng);
  const state: GameState = {
    seed,
    turn: 1,
    rngState: rng.state,
    initiative,
    finished: false,
    winnerId: null,
    map,
    depletion: new Array(cellCount).fill(0),
    looted: new Array(cellCount).fill(false),
    relics: {},
    players,
  };
  for (const player of state.players) refreshMemory(state, player);
  return state;
}

/** 入りきらなかった分を返す */
function addItem(player: PlayerState, item: ItemId, count: number): number {
  let remaining = count;
  for (const stack of player.inventory) {
    if (stack.item !== item) continue;
    const added = Math.min(remaining, STACK_SIZE - stack.count);
    stack.count += added;
    remaining -= added;
  }
  while (remaining > 0 && player.inventory.length < INVENTORY_SLOTS) {
    const added = Math.min(remaining, STACK_SIZE);
    player.inventory.push({ item, count: added });
    remaining -= added;
  }
  return remaining;
}

const hasAny = (player: PlayerState, items: readonly ItemId[]) =>
  player.inventory.some((stack) => items.includes(stack.item));

function receive(player: PlayerState, stacks: ItemStack[]) {
  const gained: ItemStack[] = [];
  const lost: ItemStack[] = [];
  for (const { item, count } of stacks) {
    const overflow = addItem(player, item, count);
    if (count - overflow > 0) gained.push({ item, count: count - overflow });
    if (overflow > 0) lost.push({ item, count: overflow });
  }
  return { gained, lost };
}

function rollItem(rng: Rng, rolls: ItemRoll[]): ItemStack {
  const roll = rng.pick(rolls);
  return { item: roll.item, count: rng.int(roll.min, roll.max) };
}

const yieldsNothing = (entry: GatherEntry, player: PlayerState) =>
  entry.kind === 'nothing' ||
  entry.kind === 'danger' ||
  (entry.kind === 'item' && !!entry.requiresAnyOf && !hasAny(player, entry.requiresAnyOf));

/** 枯渇と夜のぶんだけ、成功の重みを「何もなし」へ移す */
export function adjustedWeights(entries: GatherEntry[], depletion: number, phase: Phase): number[] {
  const penalty = Math.min(
    0.9,
    depletion * DEPLETION.penaltyPerLevel + (phase === 'night' ? NIGHT_GATHER_PENALTY : 0),
  );
  const moved = entries.reduce((sum, e) => sum + (e.kind === 'nothing' ? 0 : e.weight * penalty), 0);
  return entries.map((e) => (e.kind === 'nothing' ? e.weight + moved : e.weight * (1 - penalty)));
}

function gatherFromTable(state: GameState, player: PlayerState, index: number, rng: Rng, events: GameEvent[]) {
  const terrain = state.map.terrain[index];
  const entries = TERRAIN[terrain].gather;
  const weights = adjustedWeights(entries, state.depletion[index], phaseOf(state.turn));

  // 天井：「何もなし」が続いたら、次は必ず何か手に入る
  const pity = player.dryStreak >= PITY_AFTER_DRY_STREAK;
  const finalWeights = weights.map((w, i) => (pity && yieldsNothing(entries[i], player) ? 0 : w));
  let roll = rng.next() * finalWeights.reduce((a, b) => a + b, 0);
  let entry = entries[0];
  for (let i = 0; i < entries.length; i++) {
    if (finalWeights[i] <= 0) continue;
    entry = entries[i];
    roll -= finalWeights[i];
    if (roll < 0) break;
  }

  state.depletion[index] = Math.min(DEPLETION.max, state.depletion[index] + 1);

  const playerId = player.id;
  if (entry.kind === 'nothing') {
    player.dryStreak += 1;
    events.push({ type: 'gatherNothing', playerId, terrain, missingTool: false });
  } else if (entry.kind === 'danger') {
    player.dryStreak = 0;
    player.hp = Math.max(0, player.hp - entry.damage);
    if (player.hp === 0) eliminate(state, player);
    events.push({ type: 'gatherDanger', playerId, terrain, damage: entry.damage, eliminated: !player.alive });
  } else if (entry.kind === 'nest') {
    player.dryStreak = 0;
    player.nestBonus = true;
    events.push({ type: 'foundNest', playerId });
  } else if (entry.requiresAnyOf && !hasAny(player, entry.requiresAnyOf)) {
    player.dryStreak += 1;
    events.push({ type: 'gatherNothing', playerId, terrain, missingTool: true });
  } else {
    player.dryStreak = 0;
    events.push({ type: 'gathered', playerId, terrain, pity, ...receive(player, [rollItem(rng, entry.rolls)]) });
  }
}

/** 泉・川は確実に水が取れるので、枯渇・夜・天井の対象にしない */
function gatherWater(player: PlayerState, terrain: TerrainId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const stacks: ItemStack[] = [];
  if (hasAny(player, [CANTEEN])) stacks.push({ item: 'water', count: 1 });
  else events.push({ type: 'drank', playerId, terrain });
  if (terrain === 'river' && hasAny(player, FISHING_TOOLS) && rng.next() < RIVER_FISH_CHANCE) {
    stacks.push({ item: 'fish', count: 1 });
  }
  if (stacks.length > 0) events.push({ type: 'gathered', playerId, terrain, pity: false, ...receive(player, stacks) });
}

function gatherSpecial(
  state: GameState,
  player: PlayerState,
  index: number,
  kind: SpecialTerrainId,
  rng: Rng,
  events: GameEvent[],
) {
  const playerId = player.id;
  const first = !state.looted[index];
  // 2回目以降は天井の対象にしない（連続採取でレアを確定で取れてしまうため）
  if (!first && rng.next() < SPECIAL_REPEAT_NOTHING_CHANCE) {
    events.push({ type: 'gatherNothing', playerId, terrain: kind, missingTool: false });
    return;
  }
  state.looted[index] = true;
  player.dryStreak = 0;
  events.push({ type: 'gathered', playerId, terrain: kind, pity: false, ...receive(player, [rollItem(rng, SPECIAL_LOOT[kind])]) });
}

/** 2.3 脱落。所持品はそのマスに遺品として残る */
function eliminate(state: GameState, player: PlayerState) {
  player.hp = 0;
  player.alive = false;
  if (player.inventory.length === 0) return;
  const index = cellIndex(state, player.x, player.y);
  state.relics[index] = [...(state.relics[index] ?? []), ...player.inventory];
  player.inventory = [];
}

/** そのマスの遺品を持てるだけ拾う */
function takeRelics(state: GameState, player: PlayerState, events: GameEvent[]) {
  const index = cellIndex(state, player.x, player.y);
  const relics = state.relics[index];
  if (!relics) return;
  const { gained, lost } = receive(player, relics);
  if (lost.length > 0) state.relics[index] = lost;
  else delete state.relics[index];
  if (gained.length > 0) events.push({ type: 'relicTaken', playerId: player.id, items: gained });
}

/** 持っている中で一番強い武器。なければ素手 */
function bestWeapon(player: PlayerState): WeaponDef {
  const expected = (w: WeaponDef) => w.hit * ((w.rollsD3 ? 2 : 0) + w.bonus);
  let best = UNARMED;
  for (const { item } of player.inventory) {
    const weapon = WEAPONS[item];
    if (weapon && expected(weapon) > expected(best)) best = weapon;
  }
  return best;
}

const inRange = (ax: number, ay: number, bx: number, by: number, range: number) =>
  Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= range;

/**
 * 追跡攻撃。使えるAPの中で一番安く相手に届く道を探す。
 * 今いる場所から届くなら空の道、どうしても届かなければ null を返す。
 */
function chasePath(state: GameState, player: PlayerState, target: PlayerState, range: number, budget: number) {
  const { width, height, terrain } = state.map;
  const start = cellIndex(state, player.x, player.y);
  const costs = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  const open = [start];
  let goal = -1;
  let goalCost = Infinity;

  while (open.length > 0) {
    open.sort((a, b) => costs.get(a)! - costs.get(b)! || a - b);
    const current = open.shift()!;
    const x = current % width;
    const y = Math.floor(current / width);
    const cost = costs.get(current)!;
    if (inRange(x, y, target.x, target.y, range) && cost < goalCost) {
      goal = current;
      goalCost = cost;
      break;
    }
    for (const [dx, dy] of Object.values(DIRECTION_DELTA)) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const step = TERRAIN[terrain[next]].moveCost;
      if (step === null || cost + step > budget) continue;
      if (cost + step < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost + step);
        cameFrom.set(next, current);
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  if (goal === -1) return null;
  const path: number[] = [];
  for (let at = goal; at !== start; at = cameFrom.get(at)!) path.unshift(at);
  return path;
}

function resolveAttack(state: GameState, player: PlayerState, targetId: number, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  if (state.turn <= EARLY_PROTECTION_TURNS) {
    events.push({ type: 'blocked', playerId, reason: 'protected' });
    return;
  }
  if (player.attackedOnTurn === state.turn) {
    events.push({ type: 'blocked', playerId, reason: 'alreadyAttacked' });
    return;
  }
  if (player.ap < ATTACK_AP) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
    return;
  }

  const target = state.players[targetId];
  const weapon = bestWeapon(player);
  const path = target?.alive && target.id !== playerId
    ? chasePath(state, player, target, weapon.range, player.ap - ATTACK_AP)
    : null;
  player.attackedOnTurn = state.turn;
  if (!path) {
    player.ap -= ATTACK_AP;
    events.push({ type: 'attackFizzled', playerId });
    return;
  }

  for (const index of path) {
    const terrain = state.map.terrain[index];
    const cost = TERRAIN[terrain].moveCost!;
    player.x = index % state.map.width;
    player.y = Math.floor(index / state.map.width);
    player.ap -= cost;
    refreshMemory(state, player);
    events.push({ type: 'moved', playerId, x: player.x, y: player.y, terrain, cost });
    takeRelics(state, player, events);
  }
  player.ap -= ATTACK_AP;

  // 8.2 8.3 命中とダメージ
  const diagonal = player.x !== target.x && player.y !== target.y;
  const night = phaseOf(state.turn) === 'night';
  const hitChance =
    weapon.hit + (night ? COMBAT.nightMeleeHit : 0) + (diagonal ? COMBAT.diagonalHit : 0);
  const hit = rng.next() < hitChance;

  let damage = 0;
  let stolen: ItemStack | null = null;
  let counter = 0;
  if (hit) {
    const onRock = state.map.terrain[cellIndex(state, target.x, target.y)] === 'rock';
    const raw =
      (weapon.rollsD3 ? rng.int(1, 3) : 0) +
      weapon.bonus +
      (diagonal ? COMBAT.diagonalDamage : 0) -
      (onRock ? COMBAT.rockDefense : 0);
    damage = Math.max(1, raw);
    target.hp = Math.max(0, target.hp - damage);

    // 8.3 略奪。武器は対象外で、持てなければ奪えない
    const candidates = target.inventory.filter((stack) => !WEAPONS[stack.item]);
    if (candidates.length > 0) {
      const stack = rng.pick(candidates);
      if (addItem(player, stack.item, 1) === 0) {
        stolen = { item: stack.item, count: 1 };
        stack.count -= 1;
        if (stack.count === 0) target.inventory.splice(target.inventory.indexOf(stack), 1);
      }
    }

    // 8.1 先手の利。これから手番が来る相手はAPが減る
    const order = state.initiative.map((entry) => entry.playerId);
    if (damage >= COMBAT.firstStrikeDamage && order.indexOf(target.id) > order.indexOf(playerId)) {
      target.ap = Math.max(0, target.ap - 1);
    }

    if (target.hp === 0) {
      eliminate(state, target);
    } else if (rng.next() < COMBAT.counterChance) {
      counter = COMBAT.counterDamage;
      player.hp = Math.max(0, player.hp - counter);
    }
  }

  events.push({
    type: 'attackResult',
    attackerId: playerId,
    targetId: target.id,
    x: target.x,
    y: target.y,
    hit,
    damage,
    counter,
    stolen,
  });
  if (player.hp === 0) eliminate(state, player);
  // 8.3 とどめを刺した人は遺品を優先して拾える
  else if (!target.alive) takeRelics(state, player, events);
}

export function applyAction(previous: GameState, action: Action): ActionResult {
  const state: GameState = JSON.parse(JSON.stringify(previous));
  const events: GameEvent[] = [];
  const rng = new Rng(state.rngState);

  if (action.type === 'endTurn') {
    state.turn += 1;
    if ((state.turn - 1) % DEPLETION.recoverEveryTurns === 0) {
      state.depletion = state.depletion.map((d) => Math.max(0, d - 1));
    }
    for (const player of state.players) {
      if (!player.alive) continue;
      player.ap = AP_PER_TURN;
      refreshMemory(state, player);
    }
    state.initiative = rollInitiative(state.players, rng);
    state.rngState = rng.state;
    events.push({ type: 'turnStarted', turn: state.turn, day: dayOf(state.turn), phase: phaseOf(state.turn) });
    return { state, events };
  }

  const player = state.players[action.playerId];
  const playerId = player.id;
  if (!player.alive) {
    events.push({ type: 'blocked', playerId, reason: 'eliminated' });
    return { state, events };
  }

  switch (action.type) {
    case 'move': {
      const [dx, dy] = DIRECTION_DELTA[action.direction];
      const x = player.x + dx;
      const y = player.y + dy;
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
        events.push({ type: 'blocked', playerId, reason: 'sea' });
        break;
      }
      const index = cellIndex(state, x, y);
      const terrain = state.map.terrain[index];
      const cost = TERRAIN[terrain].moveCost;
      if (cost === null || cost > player.ap) {
        // 霧の中へ進もうとして止まった場合は、そのマスの地形が分かる
        player.memory[index] = terrain;
        events.push({
          type: 'blocked',
          playerId,
          reason: cost === null ? 'sea' : 'noAp',
          at: { x, y },
          terrain,
          cost: cost ?? undefined,
        });
        break;
      }
      player.x = x;
      player.y = y;
      player.ap -= cost;
      refreshMemory(state, player);
      events.push({ type: 'moved', playerId, x, y, terrain, cost });
      takeRelics(state, player, events);
      break;
    }
    case 'attack':
      resolveAttack(state, player, action.targetId, rng, events);
      break;
    case 'gather': {
      if (player.ap < GATHER_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      player.ap -= GATHER_AP;
      const index = cellIndex(state, player.x, player.y);
      const terrain = state.map.terrain[index];
      if (terrain === 'spring' || terrain === 'river') gatherWater(player, terrain, rng, events);
      else if (terrain === 'cave' || terrain === 'wreck' || terrain === 'ruins') {
        gatherSpecial(state, player, index, terrain, rng, events);
      } else gatherFromTable(state, player, index, rng, events);
      break;
    }
    case 'discard': {
      const stack = player.inventory.find((s) => s.item === action.item);
      if (!stack) {
        events.push({ type: 'blocked', playerId, reason: 'notOwned' });
        break;
      }
      stack.count -= 1;
      if (stack.count === 0) player.inventory.splice(player.inventory.indexOf(stack), 1);
      events.push({ type: 'discarded', playerId, item: action.item });
      break;
    }
  }

  state.rngState = rng.state;
  return { state, events };
}

/**
 * 2.4 解決フェーズと終了フェーズ。行動順に1人ずつ、予約した行動を全部実行する。
 * 霧の中への移動が止められたり、追跡で場所が変わったりしたら、その人の残りの予約は実行しない（行き先がずれるため）。
 */
export function resolveTurn(previous: GameState, plans: Record<number, PlanAction[]>): TurnResolution {
  const targetRng = new Rng(previous.rngState);
  /** 攻撃の相手は計画のときの位置で決める。夜の人影が重なっていたら、誰に当たるかは運 */
  const targetOf = (attackerId: number, action: Extract<PlanAction, { type: 'attack' }>) => {
    if (action.who !== undefined) return action.who;
    const here = previous.players.filter(
      (p) => p.alive && p.id !== attackerId && p.x === action.x && p.y === action.y,
    );
    return here.length > 0 ? targetRng.pick(here).id : -1;
  };
  const resolved = new Map<number, Action[]>();
  for (const { playerId } of previous.initiative) {
    resolved.set(
      playerId,
      (plans[playerId] ?? []).map((action): Action =>
        action.type === 'attack'
          ? { type: 'attack', playerId, targetId: targetOf(playerId, action) }
          : { ...action, playerId },
      ),
    );
  }

  let state: GameState = { ...previous, rngState: targetRng.state };
  const steps: ResolutionStep[] = [];

  for (const { playerId } of previous.initiative) {
    if (!state.players[playerId].alive) continue;
    steps.push({ actorId: playerId, events: [{ type: 'actorTurn', playerId }], state });
    const plan = resolved.get(playerId)!;
    for (let i = 0; i < plan.length; i++) {
      const before = state;
      const result = applyAction(state, plan[i]);
      state = result.state;
      const events = [...result.events];
      const stopped =
        (plan[i].type === 'move' && events.some((e) => e.type === 'blocked')) ||
        (plan[i].type === 'attack' && events.some((e) => e.type === 'moved'));
      for (const player of state.players) {
        if (before.players[player.id].alive && !player.alive) {
          events.push({ type: 'playerEliminated', playerId: player.id });
        }
      }
      const eliminated = !state.players[playerId].alive;
      if (!eliminated && stopped && i + 1 < plan.length) {
        events.push({ type: 'planCancelled', playerId, count: plan.length - i - 1 });
      }
      steps.push({ actorId: playerId, events, state });
      if (stopped || eliminated) break;
    }
  }

  // 終了フェーズ。特殊勝利の判定はマイルストーン4で足す
  const alive = state.players.filter((player) => player.alive);
  const lastOneStanding = state.players.length > 1 && alive.length === 1;
  if (lastOneStanding || alive.length === 0) {
    state = JSON.parse(JSON.stringify(state)) as GameState;
    state.finished = true;
    state.winnerId = lastOneStanding ? alive[0].id : null;
    steps.push({ actorId: null, events: [{ type: 'gameFinished', winnerId: state.winnerId }], state });
    return { state, steps };
  }

  const next = applyAction(state, { type: 'endTurn' });
  state = next.state;
  steps.push({ actorId: null, events: next.events, state });
  return { state, steps };
}
