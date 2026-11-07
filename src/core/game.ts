// ルール本体。applyAction は元の状態を変更せず、新しい状態と出来事を返す。
import {
  AMBUSH_AP,
  AP_PER_TURN,
  ATTACK_AP,
  BLEED_CONTINUE_CHANCE,
  BOTTLE,
  BOTTLE_ITEM,
  CANTEEN,
  COMBAT,
  DEFAULT_AGILITY,
  DEPLETION,
  DRINK_AT_SOURCE,
  EARLY_PROTECTION_TURNS,
  FATIGUE,
  FISHING_TOOLS,
  GATHER_AP,
  GUARD_AP,
  HIDE_AP,
  INITIAL_HP,
  INITIAL_HUNGER,
  INITIAL_WATER,
  INITIATIVE_MODIFIER,
  INVENTORY_SLOTS,
  ITEMS,
  LETTER,
  LETTER_AP,
  MAX_HUNGER,
  MAX_WATER,
  NIGHT_GATHER_PENALTY,
  PITY_AFTER_DRY_STREAK,
  POISON,
  RECIPES,
  REST_HUT_MULTIPLIER,
  RIVER_FISH_CHANCE,
  SPECIAL_LOOT,
  SPECIAL_REPEAT_NOTHING_CHANCE,
  STACK_SIZE,
  STATUS_DAMAGE,
  TERRAIN,
  THROW,
  THROW_ITEM,
  TORCH_NIGHT_VISION,
  TRAP_DAMAGE,
  UNARMED,
  VISION_BASE,
  WEAK_THRESHOLD,
  WEAPONS,
  WHISPER,
  WHISPER_AP,
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
  RecipeId,
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
export function visionRadius(terrain: TerrainId, phase: Phase, hasTorch = false): number {
  const def = TERRAIN[terrain];
  const bonus = phase === 'day' ? def.visionDay : def.visionNight + (hasTorch ? TORCH_NIGHT_VISION : 0);
  return Math.max(0, VISION_BASE + bonus);
}

export const hasItem = (player: PlayerState, item: ItemId) => player.inventory.some((stack) => stack.item === item);

/** 5章 満腹度と水分がどちらも低いと弱っている */
export const isWeak = (player: { hunger: number; water: number }) =>
  player.hunger <= WEAK_THRESHOLD && player.water <= WEAK_THRESHOLD;

const chebyshev = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

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
  const radius = visionRadius(here, phaseOf(state.turn), hasItem(player, 'torch'));
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
function rollInitiative(players: PlayerState[], rng: Rng, turn = 1): InitiativeEntry[] {
  const rolled = players
    .filter((player) => player.alive)
    .map((player) => {
      const agility = DEFAULT_AGILITY;
      const badlyHurt = player.hp <= INITIAL_HP / 2 ? INITIATIVE_MODIFIER.badlyHurt : 0;
      const overloaded = isInventoryFull(player) ? INITIATIVE_MODIFIER.overloaded : 0;
      const weak = isWeak(player) ? INITIATIVE_MODIFIER.weak : 0;
      const rested = player.restedTurn === turn - 1 && turn > 1 ? INITIATIVE_MODIFIER.rested : 0;
      const value = agility + rng.int(1, 6) + badlyHurt + overloaded + weak + rested;
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
    hunger: INITIAL_HUNGER,
    water: INITIAL_WATER,
    poisonTurns: 0,
    bleeding: false,
    bleedTicks: 0,
    fatiguedNext: false,
    tired: false,
    hidden: false,
    guardTurn: 0,
    ambushTurn: 0,
    restedTurn: 0,
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
    structures: {},
    letters: {},
    whisperIntents: [],
    whispers: [],
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

/** 7.2 道具補正。石斧で木材が倍、釣竿で魚が増える */
function rollItem(rng: Rng, rolls: ItemRoll[], player: PlayerState): ItemStack {
  const roll = rng.pick(rolls);
  let count = rng.int(roll.min, roll.max);
  if (roll.item === 'wood' && hasItem(player, 'stone_axe')) count *= 2;
  if (roll.item === 'fish' && hasItem(player, 'fishing_rod')) count += 1;
  return { item: roll.item, count };
}

function removeItem(player: PlayerState, item: ItemId, count: number) {
  let remaining = count;
  for (let i = player.inventory.length - 1; i >= 0 && remaining > 0; i--) {
    const stack = player.inventory[i];
    if (stack.item !== item) continue;
    const taken = Math.min(remaining, stack.count);
    stack.count -= taken;
    remaining -= taken;
    if (stack.count === 0) player.inventory.splice(i, 1);
  }
}

const countItem = (player: PlayerState, item: ItemId) =>
  player.inventory.reduce((sum, stack) => sum + (stack.item === item ? stack.count : 0), 0);

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
    events.push({ type: 'gathered', playerId, terrain, pity, ...receive(player, [rollItem(rng, entry.rolls, player)]) });
  }
}

/** 泉・川は確実に水が取れるので、枯渇・夜・天井の対象にしない */
function gatherWater(player: PlayerState, terrain: TerrainId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const stacks: ItemStack[] = [];
  if (hasAny(player, [CANTEEN])) stacks.push({ item: 'water', count: 1 });
  else {
    player.water = Math.min(MAX_WATER, player.water + DRINK_AT_SOURCE);
    events.push({ type: 'drank', playerId, terrain });
  }
  if (terrain === 'river' && hasAny(player, FISHING_TOOLS) && rng.next() < RIVER_FISH_CHANCE) {
    stacks.push({ item: 'fish', count: hasItem(player, 'fishing_rod') ? 2 : 1 });
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
  events.push({ type: 'gathered', playerId, terrain: kind, pity: false, ...receive(player, [rollItem(rng, SPECIAL_LOOT[kind], player)]) });
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

/** 使える武器を強い順に並べる。夜は遠距離武器を使えない。素手は必ず入る */
function weaponsBestFirst(player: PlayerState, night: boolean): WeaponDef[] {
  const expected = (w: WeaponDef) => w.hit * ((w.rollsD3 ? 2 : 0) + w.bonus);
  const owned = player.inventory.flatMap(({ item }) => {
    const weapon = WEAPONS[item];
    return weapon && !(night && weapon.ranged) ? [weapon] : [];
  });
  return [...owned, UNARMED].sort((a, b) => expected(b) - expected(a));
}

function inRange(ax: number, ay: number, bx: number, by: number, weapon: WeaponDef) {
  if (chebyshev(ax, ay, bx, by) > weapon.range) return false;
  if (!weapon.straightOnly) return true;
  return ax === bx || ay === by || Math.abs(ax - bx) === Math.abs(ay - by);
}

/**
 * 追跡攻撃。使えるAPの中で一番安く相手に届く道を探す。
 * 今いる場所から届くなら空の道、どうしても届かなければ null を返す。
 */
function chasePath(state: GameState, player: PlayerState, target: PlayerState, weapon: WeaponDef, budget: number) {
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
    if (inRange(x, y, target.x, target.y, weapon) && cost < goalCost) {
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

/** マスに着いたときに起きること。遺品、隠れている人、罠、待ち伏せ */
function arrive(state: GameState, player: PlayerState, rng: Rng, events: GameEvent[]) {
  takeRelics(state, player, events);
  const index = cellIndex(state, player.x, player.y);

  for (const other of state.players) {
    if (other.id !== player.id && other.alive && other.hidden && other.x === player.x && other.y === player.y) {
      other.hidden = false;
      events.push({ type: 'foundOut', playerId: other.id });
      events.push({ type: 'spotted', playerId: player.id, x: other.x, y: other.y });
    }
  }

  const structure = state.structures[index];
  if (structure?.kind === 'trap' && structure.ownerId !== player.id) {
    delete state.structures[index];
    events.push({ type: 'trapSprung', playerId: structure.ownerId, x: player.x, y: player.y });
    // 6章 警戒していれば罠を見つけられる
    if (player.guardTurn === state.turn) {
      events.push({ type: 'trapDisarmed', playerId: player.id });
    } else {
      player.hp = Math.max(0, player.hp - TRAP_DAMAGE);
      player.ap = 0;
      events.push({ type: 'trapTriggered', playerId: player.id, damage: TRAP_DAMAGE });
      if (player.hp === 0) {
        eliminate(state, player);
        return;
      }
    }
  }

  // 8.2 待ち伏せは行動順に関係なく割り込む
  for (const other of state.players) {
    if (other.id === player.id || !other.alive || !player.alive) continue;
    if (other.ambushTurn !== state.turn || other.attackedOnTurn === state.turn) continue;
    if (other.x !== player.x || other.y !== player.y) continue;
    other.attackedOnTurn = state.turn;
    other.hidden = false;
    strike(state, other, player, weaponsBestFirst(other, phaseOf(state.turn) === 'night')[0], rng, events, true);
  }
}

/** 8.2 8.3 命中判定からダメージ、反撃、略奪、脱落まで */
function strike(
  state: GameState,
  attacker: PlayerState,
  target: PlayerState,
  weapon: WeaponDef,
  rng: Rng,
  events: GameEvent[],
  ambush: boolean,
) {
  const distance = chebyshev(attacker.x, attacker.y, target.x, target.y);
  const diagonal = attacker.x !== target.x && attacker.y !== target.y;
  const night = phaseOf(state.turn) === 'night';
  const guarding = target.guardTurn === state.turn;
  const targetTerrain = state.map.terrain[cellIndex(state, target.x, target.y)];
  const hitChance =
    weapon.hit +
    (night && !weapon.ranged ? COMBAT.nightMeleeHit : 0) +
    (diagonal ? COMBAT.diagonalHit : 0) +
    (guarding ? COMBAT.guardHit : 0) +
    (weapon.ranged && targetTerrain === 'forest' ? COMBAT.rangedIntoForest : 0);
  const hit = rng.next() < hitChance;

  let damage = 0;
  let stolen: ItemStack | null = null;
  let counter = 0;
  let bleeding = false;
  if (hit) {
    const raw =
      (weapon.rollsD3 ? rng.int(1, 3) : 0) +
      weapon.bonus +
      (diagonal ? COMBAT.diagonalDamage : 0) -
      (targetTerrain === 'rock' ? COMBAT.rockDefense : 0);
    damage = Math.max(0, Math.max(1, raw) - (guarding ? COMBAT.guardDamage : 0));
    target.hp = Math.max(0, target.hp - damage);

    // 5章 出血。傷を負わなければ血は出ない
    if (damage > 0 && weapon.bleed > 0 && !target.bleeding && rng.next() < weapon.bleed) {
      target.bleeding = true;
      target.bleedTicks = 0;
      bleeding = true;
    }

    // 8.3 略奪。武器は対象外で、持てなければ奪えない。離れた所からは奪えない
    const candidates = distance <= 1 ? target.inventory.filter((stack) => !WEAPONS[stack.item]) : [];
    if (candidates.length > 0) {
      const stack = rng.pick(candidates);
      if (addItem(attacker, stack.item, 1) === 0) {
        stolen = { item: stack.item, count: 1 };
        stack.count -= 1;
        if (stack.count === 0) target.inventory.splice(target.inventory.indexOf(stack), 1);
      }
    }

    // 8.1 先手の利。これから手番が来る相手はAPが減る
    const order = state.initiative.map((entry) => entry.playerId);
    if (damage >= COMBAT.firstStrikeDamage && order.indexOf(target.id) > order.indexOf(attacker.id)) {
      target.ap = Math.max(0, target.ap - 1);
    }

    if (target.hp === 0) {
      eliminate(state, target);
    } else if (distance === 0 && rng.next() < COMBAT.counterChance) {
      // 8.3 反撃。殴り返せるのは同じマスにいるときだけ
      counter = COMBAT.counterDamage;
      attacker.hp = Math.max(0, attacker.hp - counter);
    }
  }

  events.push({
    type: 'attackResult',
    attackerId: attacker.id,
    targetId: target.id,
    x: target.x,
    y: target.y,
    hit,
    damage,
    counter,
    stolen,
    ambush,
    bleeding,
    bottleBroke: weapon === BOTTLE,
  });
  if (attacker.hp === 0) eliminate(state, attacker);
  // 8.3 とどめを刺した人は遺品を優先して拾える
  else if (!target.alive && distance === 0) takeRelics(state, attacker, events);
}

function resolveAttack(
  state: GameState,
  player: PlayerState,
  targetId: number,
  choice: { throwStone: boolean; useBottle: boolean },
  rng: Rng,
  events: GameEvent[],
) {
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
  const night = phaseOf(state.turn) === 'night';
  // 投石と瓶は自分で選んだときだけ使う。持っていなければ不発
  const candidates = choice.throwStone
    ? !night && hasItem(player, THROW_ITEM) ? [THROW] : []
    : choice.useBottle
      ? hasItem(player, BOTTLE_ITEM) ? [BOTTLE] : []
      : weaponsBestFirst(player, night);
  // 隠れている相手は、同じマスにいるときしか狙えない
  const reachable =
    target?.alive && target.id !== playerId && (!target.hidden || (target.x === player.x && target.y === player.y));

  let weapon: WeaponDef | null = null;
  let path: number[] | null = null;
  if (reachable) {
    for (const candidate of candidates) {
      path = chasePath(state, player, target, candidate, player.ap - ATTACK_AP);
      if (path) {
        weapon = candidate;
        break;
      }
    }
  }

  player.attackedOnTurn = state.turn;
  player.hidden = false;
  if (!weapon || !path) {
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
    arrive(state, player, rng, events);
    // 罠や待ち伏せで止められた
    if (!player.alive || player.ap < ATTACK_AP) return;
  }
  if (!target.alive) return;
  player.ap -= ATTACK_AP;
  if (weapon === THROW) removeItem(player, THROW_ITEM, 1);
  if (weapon === BOTTLE) removeItem(player, BOTTLE_ITEM, 1);
  strike(state, player, target, weapon, rng, events, false);
}

/** 6.1 手紙やチャットの文字から、制御文字を除いて長さをそろえる */
export function cleanText(text: unknown, maxLength: number): string {
  if (typeof text !== 'string') return '';
  return Array.from(text.replace(/\p{C}/gu, ' ').trim()).slice(0, maxLength).join('');
}

function useItem(player: PlayerState, item: ItemId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const effect = ITEMS[item].use;
  if (!effect || countItem(player, item) === 0) {
    events.push({ type: 'blocked', playerId, reason: 'notOwned' });
    return;
  }
  removeItem(player, item, 1);
  const hunger = Math.min(MAX_HUNGER - player.hunger, effect.hunger ?? 0);
  const water = Math.min(MAX_WATER - player.water, effect.water ?? 0);
  const hp = Math.min(INITIAL_HP - player.hp, effect.hp ?? 0);
  player.hunger += hunger;
  player.water += water;
  player.hp += hp;
  const poisoned = !!effect.risky && rng.next() < POISON.chance;
  if (poisoned) player.poisonTurns = POISON.turns;
  if (effect.leaves) addItem(player, effect.leaves, 1);
  const stoppedBleeding = !!effect.stopsBleeding && player.bleeding;
  if (stoppedBleeding) {
    player.bleeding = false;
    player.bleedTicks = 0;
  }
  events.push({ type: 'used', playerId, item, hunger, water, hp, poisoned, stoppedBleeding });
}

/** 行動の種類ごとの疲れやすさ。実際にAPを使ったときだけ起きる */
function fatigueChance(action: Action, apSpent: number): number {
  if (apSpent <= 0) return 0;
  switch (action.type) {
    case 'move':
      return FATIGUE.movePerAp * apSpent;
    case 'gather':
      return FATIGUE.gather;
    case 'attack':
      return FATIGUE.attack;
    case 'craft':
      return RECIPES[action.recipe].builds ? FATIGUE.build : FATIGUE.craft;
    default:
      return 0;
  }
}

function craft(state: GameState, player: PlayerState, recipeId: RecipeId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const recipe = RECIPES[recipeId];
  if (player.ap < recipe.ap) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
    return;
  }
  const inputs = recipe.inputs.find((set) => set.every(({ item, count }) => countItem(player, item) >= count));
  if (!inputs) {
    events.push({ type: 'blocked', playerId, reason: 'missingMaterials' });
    return;
  }
  const index = cellIndex(state, player.x, player.y);
  if (recipe.builds && state.structures[index]) {
    events.push({ type: 'blocked', playerId, reason: 'occupied' });
    return;
  }
  // 持ちきれない物を作って素材を失わないよう、入るかどうかを先に確かめる
  const before = player.inventory.map((stack) => ({ ...stack }));
  for (const { item, count } of inputs) removeItem(player, item, count);
  if (recipe.output && addItem(player, recipe.output.item, recipe.output.count) > 0) {
    player.inventory = before;
    events.push({ type: 'blocked', playerId, reason: 'inventoryFull' });
    return;
  }
  player.ap -= recipe.ap;
  if (recipe.builds) state.structures[index] = { kind: recipe.builds, ownerId: playerId };
  events.push({ type: 'crafted', playerId, recipe: recipeId, gained: recipe.output ? [recipe.output] : [], lost: [] });
  // 出血しているなら、作った包帯をそのまま巻く
  if (recipe.output && ITEMS[recipe.output.item].use?.stopsBleeding && player.bleeding) {
    useItem(player, recipe.output.item, rng, events);
  }
}

/** 6.1 相手が応じたら密談を始める。本人以外や終わった密談には何もしない */
export function respondWhisper(previous: GameState, playerId: number, id: number, accept: boolean): GameState | null {
  const whisper = previous.whispers.find((w) => w.id === id);
  if (!whisper || whisper.to !== playerId || whisper.status !== 'pending') return null;
  const state: GameState = JSON.parse(JSON.stringify(previous));
  state.whispers.find((w) => w.id === id)!.status = accept ? 'open' : 'refused';
  return state;
}

/** 6.1 1回の密談で各3メッセージ、50文字まで */
export function sendWhisper(previous: GameState, playerId: number, id: number, text: unknown): GameState | null {
  const whisper = previous.whispers.find((w) => w.id === id);
  if (!whisper || whisper.status !== 'open') return null;
  if (whisper.from !== playerId && whisper.to !== playerId) return null;
  const sent = whisper.messages.filter((message) => message.from === playerId).length;
  const clean = cleanText(text, WHISPER.maxLength);
  if (sent >= WHISPER.maxMessagesEach || !clean) return null;
  const state: GameState = JSON.parse(JSON.stringify(previous));
  state.whispers.find((w) => w.id === id)!.messages.push({ from: playerId, text: clean });
  return state;
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
    // 2.4 開始フェーズ。満腹度と水分は昼ターンにだけ減る。0のときのダメージは毎ターン
    const isDay = phaseOf(state.turn) === 'day';
    for (const player of state.players) {
      if (!player.alive) continue;
      if (isDay) {
        player.hunger = Math.max(0, player.hunger - 1);
        player.water = Math.max(0, player.water - 1);
      }
      const hunger = player.hunger === 0 ? STATUS_DAMAGE.starving : 0;
      const thirst = player.water === 0 ? STATUS_DAMAGE.thirsty : 0;
      const poison = player.poisonTurns > 0 ? STATUS_DAMAGE.poison : 0;
      const bleed = player.bleeding ? STATUS_DAMAGE.bleed : 0;
      if (player.poisonTurns > 0) player.poisonTurns -= 1;
      if (hunger + thirst + poison + bleed > 0) {
        player.hp = Math.max(0, player.hp - hunger - thirst - poison - bleed);
        events.push({ type: 'statusDamage', playerId: player.id, hunger, thirst, poison, bleed });
        if (player.hp === 0) {
          eliminate(state, player);
          continue;
        }
      }
      // 1回目のダメージは必ず受け、そのあとは回を重ねるほど止まりやすくなる
      if (player.bleeding) {
        const chance = BLEED_CONTINUE_CHANCE[player.bleedTicks] ?? 0;
        player.bleedTicks += 1;
        if (rng.next() >= chance) {
          player.bleeding = false;
          player.bleedTicks = 0;
          events.push({ type: 'bleedStopped', playerId: player.id });
        }
      }
      player.tired = player.fatiguedNext;
      player.fatiguedNext = false;
      player.ap = AP_PER_TURN - (isWeak(player) ? 1 : 0) - (player.tired ? 1 : 0);
      refreshMemory(state, player);
    }
    state.initiative = rollInitiative(state.players, rng, state.turn);
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
  const apBefore = player.ap;

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
      player.hidden = false;
      refreshMemory(state, player);
      events.push({ type: 'moved', playerId, x, y, terrain, cost });
      arrive(state, player, rng, events);
      break;
    }
    case 'attack':
      resolveAttack(
        state,
        player,
        action.targetId,
        { throwStone: !!action.throwStone, useBottle: !!action.useBottle },
        rng,
        events,
      );
      break;
    case 'use':
      useItem(player, action.item, rng, events);
      break;
    case 'craft':
      craft(state, player, action.recipe, rng, events);
      break;
    case 'rest': {
      if (player.ap <= 0) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      const inHut = state.structures[cellIndex(state, player.x, player.y)]?.kind === 'hut';
      const healed = Math.min(INITIAL_HP - player.hp, player.ap * (inHut ? REST_HUT_MULTIPLIER : 1));
      player.hp += healed;
      player.ap = 0;
      player.restedTurn = state.turn;
      // 休めば次のターンに疲れを持ち越さない
      player.fatiguedNext = false;
      events.push({ type: 'rested', playerId, healed });
      break;
    }
    case 'guard': {
      if (player.ap < GUARD_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      player.ap -= GUARD_AP;
      player.guardTurn = state.turn;
      events.push({ type: 'guarded', playerId });
      // 6章 隣のマスに隠れている人も見つける
      for (const other of state.players) {
        if (other.id === playerId || !other.alive || !other.hidden) continue;
        if (chebyshev(player.x, player.y, other.x, other.y) > 1) continue;
        other.hidden = false;
        events.push({ type: 'foundOut', playerId: other.id });
        events.push({ type: 'spotted', playerId, x: other.x, y: other.y });
      }
      break;
    }
    case 'hide': {
      if (player.ap < HIDE_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else if (!TERRAIN[state.map.terrain[cellIndex(state, player.x, player.y)]].canHide) {
        events.push({ type: 'blocked', playerId, reason: 'cannotHide' });
      } else {
        player.ap -= HIDE_AP;
        player.hidden = true;
        events.push({ type: 'hid', playerId });
      }
      break;
    }
    case 'ambush': {
      if (state.turn <= EARLY_PROTECTION_TURNS) {
        events.push({ type: 'blocked', playerId, reason: 'protected' });
      } else if (player.ap < AMBUSH_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= AMBUSH_AP;
        player.ambushTurn = state.turn;
        events.push({ type: 'ambushSet', playerId });
      }
      break;
    }
    case 'letter': {
      const text = cleanText(action.text, LETTER.maxLength);
      if (player.ap < LETTER_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else if (!text || countItem(player, LETTER.material) === 0) {
        events.push({ type: 'blocked', playerId, reason: 'missingMaterials' });
      } else {
        player.ap -= LETTER_AP;
        removeItem(player, LETTER.material, 1);
        const index = cellIndex(state, player.x, player.y);
        state.letters[index] = [...(state.letters[index] ?? []), { text }];
        events.push({ type: 'letterLeft', playerId });
      }
      break;
    }
    case 'whisper': {
      if (player.ap < WHISPER_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= WHISPER_AP;
        state.whisperIntents.push({ from: playerId, to: action.targetId });
        events.push({ type: 'whisperAsked', playerId });
      }
      break;
    }
    case 'gather': {
      if (player.ap < GATHER_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      player.ap -= GATHER_AP;
      player.hidden = false;
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

  // 5章 疲労。もう疲れているときは振らない
  const chance = fatigueChance(action, apBefore - player.ap);
  if (chance > 0 && player.alive && !player.fatiguedNext && rng.next() < chance) {
    player.fatiguedNext = true;
    events.push({ type: 'fatigued', playerId });
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
  /** 攻撃や密談の相手は計画のときの位置で決める。夜の人影が重なっていたら、誰に当たるかは運 */
  const targetOf = (attackerId: number, action: { x: number; y: number; who?: number }) => {
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
      (plans[playerId] ?? []).map((action): Action => {
        if (action.type === 'attack') {
          return {
            type: 'attack',
            playerId,
            targetId: targetOf(playerId, action),
            throwStone: action.throwStone,
            useBottle: action.useBottle,
          };
        }
        if (action.type === 'whisper') return { type: 'whisper', playerId, targetId: targetOf(playerId, action) };
        return { ...action, playerId };
      }),
    );
  }

  let state: GameState = JSON.parse(JSON.stringify(previous));
  state.rngState = targetRng.state;
  // 密談は次の計画フェーズの間だけ
  state.whispers = [];
  state.whisperIntents = [];
  // 防御と待ち伏せは予約なので、自分の手番より前に来た相手にも効く
  for (const player of state.players) {
    const plan = plans[player.id] ?? [];
    if (plan.some((action) => action.type === 'guard')) player.guardTurn = state.turn;
    if (plan.some((action) => action.type === 'ambush') && state.turn > EARLY_PROTECTION_TURNS) {
      player.ambushTurn = state.turn;
    }
  }
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

  // 6.1 密談は解決フェーズ終了時点の位置で判定する
  state = JSON.parse(JSON.stringify(state)) as GameState;
  const whisperEvents: GameEvent[] = [];
  for (const intent of state.whisperIntents) {
    const from = state.players[intent.from];
    const to = state.players[intent.to];
    const near = to?.alive && from.alive && to.id !== from.id && chebyshev(from.x, from.y, to.x, to.y) <= 1;
    if (near) {
      state.whispers.push({ id: state.whispers.length, from: from.id, to: to.id, status: 'pending', messages: [] });
    } else if (from.alive) {
      whisperEvents.push({ type: 'whisperFailed', playerId: from.id });
    }
  }
  state.whisperIntents = [];
  if (whisperEvents.length > 0) steps.push({ actorId: null, events: whisperEvents, state });

  // 終了フェーズ。特殊勝利の判定はマイルストーン4で足す
  const finish = () => {
    const alive = state.players.filter((player) => player.alive);
    const lastOneStanding = state.players.length > 1 && alive.length === 1;
    if (!lastOneStanding && alive.length > 0) return false;
    state = JSON.parse(JSON.stringify(state)) as GameState;
    state.finished = true;
    state.winnerId = lastOneStanding ? alive[0].id : null;
    steps.push({ actorId: null, events: [{ type: 'gameFinished', winnerId: state.winnerId }], state });
    return true;
  };
  if (finish()) return { state, steps };

  const before = state;
  const next = applyAction(state, { type: 'endTurn' });
  state = next.state;
  const events = [...next.events];
  for (const player of state.players) {
    if (before.players[player.id].alive && !player.alive) {
      events.push({ type: 'playerEliminated', playerId: player.id });
    }
  }
  steps.push({ actorId: null, events, state });
  finish();
  return { state, steps };
}
