// ルール本体。applyAction は元の状態を変更せず、新しい状態と出来事を返す。
import {
  AID_AP,
  AMBUSH_AP,
  CURSE_HIT,
  FINAL,
  FOLLOWER_GATHER,
  HUNT_AP,
  SWIM_COST,
  WEATHER,
  BIG_EATER_HP,
  EARLY_RISER_BONUS,
  EXPLORE_AP,
  FISHER_FISH_MULTIPLIER,
  HEAL_AP,
  LOST_SENSE_DRIFT,
  LOST_SENSE_GATHER,
  MAP_FRAGMENT_RADIUS,
  REPAIR_AP,
  SOLDIER,
  TENACITY_HP,
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
  SPECIAL_TERRAINS,
  STACK_SIZE,
  STATUS_DAMAGE,
  TERRAIN,
  THROW,
  THROW_ITEM,
  TORCH_NIGHT_VISION,
  TRAP_DAMAGE,
  UNARMED,
  VISION_BASE,
  WATER_TERRAINS,
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
import { BACKPACK_SLOTS, GOALS, JOBS, RAFT, SMOKE, STEAL_PRIORITY } from './roles';
import { courseIngredients, findWinner, hasRole, isNearVictory, newProgress } from './victory';
import { aidNpc, drownCheck, haunt, huntNpc, moveNpcs, seedAnimals, startOfTurn } from './world';
import type {
  JobId,
  PlayerSetup,
  Structure,
  VictoryReason,
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

/** 職業、特性、道具、探索を合わせた今の視界 */
export function playerVision(state: GameState, player: PlayerState): number {
  const here = state.map.terrain[cellIndex(state, player.x, player.y)];
  // 夜目は夜でも昼と同じ視界
  const phase = player.publicTrait === 'night_eyes' ? 'day' : phaseOf(state.turn);
  let radius = visionRadius(here, phase, hasItem(player, 'torch'));
  if (hasRole(player, 'explorer')) radius += 1;
  if (phaseOf(state.turn) === 'day' && hasItem(player, 'binoculars')) radius += 1;
  if (player.exploreTurn === state.turn) radius += 1;
  if (state.world) {
    // 9章 雨の日は視界−1。8.5 幽霊の濃霧の中も視界−1
    if (state.weather === 'rain') radius -= 1;
    const cell = cellIndex(state, player.x, player.y);
    if (state.fog.some((f) => f.untilTurn >= state.turn && f.cells.includes(cell))) radius -= 1;
  }
  return Math.max(0, radius);
}

/** 移動コスト。嵐の日は+1。泳ぎ上手は沈んだマスを渡れる */
export function moveCostOf(state: GameState, player: PlayerState, index: number): number | null {
  const terrain = state.map.terrain[index];
  let cost = TERRAIN[terrain].moveCost;
  if (cost === null && player.publicTrait === 'swimmer' && state.sunk.includes(index)) cost = SWIM_COST;
  if (cost === null) return null;
  return state.world && state.weather === 'storm' ? cost + WEATHER.stormMoveCost : cost;
}

/** 特性や道具まで含めて、夜に誰なのかまで見えるか */
export const seesNames = (state: GameState, viewer: PlayerState, other: PlayerState) =>
  phaseOf(state.turn) === 'day' || viewer.publicTrait === 'night_eyes' || hasItem(other, 'torch');

export function visibleCells(state: GameState, player: PlayerState): number[] {
  const { width, height, terrain } = state.map;
  // 9.2 最終局面は霧がなくなる
  if (state.finalPhase) return terrain.map((_, i) => i);
  const here = terrain[cellIndex(state, player.x, player.y)];
  const radius = playerVision(state, player);
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
      // 島の主は重く、持っていると機敏さが1下がる
      const agility = (player.job ? JOBS[player.job].agility : DEFAULT_AGILITY) - (hasItem(player, 'island_lord') ? 1 : 0);
      const badlyHurt = player.hp <= player.maxHp / 2 ? INITIATIVE_MODIFIER.badlyHurt : 0;
      const overloaded = isInventoryFull(player) ? INITIATIVE_MODIFIER.overloaded : 0;
      const weak = isWeak(player) ? INITIATIVE_MODIFIER.weak : 0;
      const rested = player.restedTurn === turn - 1 && turn > 1 ? INITIATIVE_MODIFIER.rested : 0;
      const early = player.secretTrait === 'early_riser' && phaseOf(turn) === 'day' ? EARLY_RISER_BONUS : 0;
      const value = agility + rng.int(1, 6) + badlyHurt + overloaded + weak + rested + early;
      return { entry: { playerId: player.id, value, agility }, tiebreak: rng.next() };
    });
  rolled.sort(
    (a, b) => b.entry.value - a.entry.value || b.entry.agility - a.entry.agility || a.tiebreak - b.tiebreak,
  );
  return rolled.map((r) => r.entry);
}

/** リュックがあれば枠が増える */
export const slotsOf = (player: PlayerState) => INVENTORY_SLOTS + (hasItem(player, 'backpack') ? BACKPACK_SLOTS : 0);

const isInventoryFull = (player: PlayerState) =>
  player.inventory.length >= slotsOf(player) && player.inventory.every((stack) => stack.count >= STACK_SIZE);

export interface CreateGameOptions {
  mapSize?: MapSize;
  /** 実際に遊ぶ人数。島の大きさは playerCount で決まり、足りない席はCPUが入るまで空く */
  seats?: number;
  names?: string[];
  /** キャラ選択の結果。なければ職業も特性もない */
  setups?: PlayerSetup[];
  /** 天候・イベント・動物・最終局面を動かす */
  world?: boolean;
}

/** 秘密特性が発動した瞬間に公開する */
function reveal(player: PlayerState, events: GameEvent[]) {
  if (player.secretRevealed || !player.secretTrait) return;
  player.secretRevealed = true;
  events.push({ type: 'traitRevealed', playerId: player.id, trait: player.secretTrait });
}

function applySetup(state: GameState, player: PlayerState, setup: PlayerSetup, rng: Rng) {
  player.job = setup.job;
  player.publicTrait = setup.publicTrait;
  player.secretTrait = setup.secretTrait;
  player.extraJob = setup.extraJob ?? null;
  const start = state.map.starts[setup.start];
  player.x = start.x;
  player.y = start.y;
  for (const { item, count } of setup.items) addItem(player, item, count);
  if (setup.publicTrait === 'big_eater') {
    player.maxHp += BIG_EATER_HP;
    player.hp = player.maxHp;
  }
  const { terrain, width, height } = state.map;
  // 島の記憶：水源の位置が最初から分かる
  if (setup.publicTrait === 'island_memory') {
    terrain.forEach((t, i) => {
      if (WATER_TERRAINS.includes(t)) player.memory[i] = t;
    });
  }
  // 地図の断片：どこか一部の霧が最初から晴れている
  if (hasItem(player, 'map_fragment')) {
    const cx = rng.int(MAP_FRAGMENT_RADIUS, width - 1 - MAP_FRAGMENT_RADIUS);
    const cy = rng.int(MAP_FRAGMENT_RADIUS, height - 1 - MAP_FRAGMENT_RADIUS);
    for (let y = cy - MAP_FRAGMENT_RADIUS; y <= cy + MAP_FRAGMENT_RADIUS; y++) {
      for (let x = cx - MAP_FRAGMENT_RADIUS; x <= cx + MAP_FRAGMENT_RADIUS; x++) {
        player.memory[y * width + x] = terrain[y * width + x];
      }
    }
  }
}

export function createGame(seed: string, playerCount: number, mapSizeOrOptions: MapSize | CreateGameOptions = 'small'): GameState {
  const options: CreateGameOptions =
    typeof mapSizeOrOptions === 'string' ? { mapSize: mapSizeOrOptions } : mapSizeOrOptions;
  const rng = new Rng(hashSeed(`${seed}`));
  const map = generateMap(rng, playerCount, options.mapSize ?? 'small');
  const cellCount = map.width * map.height;
  const players: PlayerState[] = map.starts.slice(0, options.setups?.length ?? options.seats ?? playerCount).map((start, id) => ({
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
    maxHp: INITIAL_HP,
    job: null,
    publicTrait: null,
    secretTrait: null,
    extraJob: null,
    secretRevealed: false,
    secretUsed: false,
    progress: newProgress(),
    freeMoveTurn: 0,
    freeWhisperDay: 0,
    scoutDay: 0,
    exploreTurn: 0,
    playingDead: false,
    reviving: false,
    repairedTurn: 0,
    radioFixed: false,
    treatedOnce: false,
    killerId: null,
    hauntedOn: 0,
    curseUsed: false,
    cursedTurn: 0,
    hpAtTurnStart: INITIAL_HP,
    swamTurn: 0,
  }));
  const state: GameState = {
    seed,
    turn: 1,
    rngState: rng.state,
    initiative: [],
    finished: false,
    winnerId: null,
    victoryReason: null,
    ship: null,
    scouts: [],
    nearNotified: [],
    world: !!options.world,
    weather: 'sunny',
    npcs: [],
    nextNpcId: 1,
    footprints: [],
    sinkNext: [],
    sunk: [],
    finalPhase: false,
    fog: [],
    blessed: [],
    supply: null,
    critterRespawns: [],
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
  options.setups?.forEach((setup, id) => applySetup(state, state.players[id], setup, rng));
  for (const player of state.players) {
    refreshMemory(state, player);
    markVisited(state, player);
  }
  if (state.world) seedAnimals(state, rng);
  state.initiative = rollInitiative(players, rng);
  state.rngState = rng.state;
  return state;
}

/** 4.5 探検家の踏破と特殊マスの訪問を記録する */
function markVisited(state: GameState, player: PlayerState) {
  const index = cellIndex(state, player.x, player.y);
  const { explored, specialsVisited } = player.progress;
  if (!explored.includes(index)) explored.push(index);
  if ((SPECIAL_TERRAINS as readonly TerrainId[]).includes(state.map.terrain[index]) && !specialsVisited.includes(index)) {
    specialsVisited.push(index);
  }
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
  while (remaining > 0 && player.inventory.length < slotsOf(player)) {
    const added = Math.min(remaining, STACK_SIZE);
    player.inventory.push({ item, count: added });
    remaining -= added;
  }
  return remaining;
}

const hasAny = (player: PlayerState, items: readonly ItemId[]) =>
  player.inventory.some((stack) => items.includes(stack.item));

export function receive(player: PlayerState, stacks: ItemStack[]) {
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
  // 沈んだマス（海）には採れるものがない
  if (entries.length === 0) {
    events.push({ type: 'gatherNothing', playerId: player.id, terrain, missingTool: false });
    return;
  }
  const weights = adjustedWeights(entries, state.depletion[index], phaseOf(state.turn));

  // 4.2 漁師は砂浜で魚が出やすい
  if (hasRole(player, 'fisher') && terrain === 'beach') {
    entries.forEach((e, i) => {
      if (e.kind === 'item' && e.rolls.some((r) => r.item === 'fish')) weights[i] *= FISHER_FISH_MULTIPLIER;
    });
  }
  // 4.3 方向音痴、9.1 漂流者の同行、8.5 幽霊の守護は採取率が上がる
  const follower = state.npcs.some((n) => n.followerOf === player.id);
  const blessed = state.blessed.some((b) => b.untilTurn >= state.turn && b.cells.includes(index));
  const points =
    (player.secretTrait === 'lost_sense' ? LOST_SENSE_GATHER : 0) +
    (follower ? FOLLOWER_GATHER : 0) +
    (blessed ? FOLLOWER_GATHER : 0);
  if (points > 0) {
    const nothing = entries.findIndex((e) => e.kind === 'nothing');
    const moved = Math.min(weights[nothing], points);
    weights[nothing] -= moved;
    const first = entries.findIndex((e) => e.kind === 'item');
    weights[first] += moved;
  }
  // 9.2 最終局面では採取の成功率が半分になる
  if (state.finalPhase) {
    const nothing = entries.findIndex((e) => e.kind === 'nothing');
    entries.forEach((_, i) => {
      if (i === nothing) return;
      const moved = weights[i] * FINAL.gatherPenalty;
      weights[i] -= moved;
      weights[nothing] += moved;
    });
  }

  // 天井：「何もなし」が続いたら、次は必ず何か手に入る
  const pity = player.dryStreak >= PITY_AFTER_DRY_STREAK;
  const finalWeights = weights.map((w, i) => (pity && yieldsNothing(entries[i], player) ? 0 : w));
  const draw = () => {
    let roll = rng.next() * finalWeights.reduce((a, b) => a + b, 0);
    let chosen = entries[0];
    for (let i = 0; i < entries.length; i++) {
      if (finalWeights[i] <= 0) continue;
      chosen = entries[i];
      roll -= finalWeights[i];
      if (roll < 0) break;
    }
    return chosen;
  };
  let entry = draw();
  // 4.3 強運は「何もなし」を引き直す
  if (entry.kind === 'nothing' && player.publicTrait === 'lucky') entry = draw();

  state.depletion[index] = Math.min(DEPLETION.max, state.depletion[index] + 1);

  const playerId = player.id;
  if (entry.kind === 'nothing') {
    player.dryStreak += 1;
    events.push({ type: 'gatherNothing', playerId, terrain, missingTool: false });
  } else if (entry.kind === 'danger') {
    player.dryStreak = 0;
    player.hp = Math.max(0, player.hp - entry.damage);
    if (player.hp === 0) eliminate(state, player, events);
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
    const received = receive(player, [rollItem(rng, entry.rolls, player)]);
    events.push({ type: 'gathered', playerId, terrain, pity, ...received });
    fishCaught(player, received.gained, rng, events);
  }
}

/** 4.5 漁師の釣果を数える。天井に届くと島の主がかかる */
function fishCaught(player: PlayerState, gained: ItemStack[], rng: Rng, events: GameEvent[]) {
  if (!hasRole(player, 'fisher')) return;
  const caught = gained.filter((s) => s.item === 'fish').reduce((sum, s) => sum + s.count, 0);
  if (caught === 0 || hasItem(player, 'island_lord')) return;
  const p = player.progress;
  p.fishCaught += caught;
  const ceiling = p.lordCaughtBefore ? GOALS.secondLordCeiling : GOALS.lordCeiling;
  if (p.fishCaught < ceiling && rng.next() >= GOALS.lordChance) return;
  if (addItem(player, 'island_lord', 1) > 0) return;
  p.fishCaught = 0;
  p.lordCaughtBefore = true;
  p.lordHeldTurns = 0;
  events.push({ type: 'lordCaught' });
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
  if (stacks.length > 0) {
    const received = receive(player, stacks);
    events.push({ type: 'gathered', playerId, terrain, pity: false, ...received });
    fishCaught(player, received.gained, rng, events);
  }
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
export function eliminate(state: GameState, player: PlayerState, events: GameEvent[]) {
  // 4.3 死んだふり：HP1で耐える。他の人には脱落に見せる
  if (player.secretTrait === 'play_dead' && !player.secretUsed && !state.finalPhase) {
    player.secretUsed = true;
    player.hp = 1;
    player.playingDead = true;
    events.push({ type: 'playerEliminated', playerId: player.id });
    return;
  }
  player.hp = 0;
  player.alive = false;
  player.bleeding = false;
  player.poisonTurns = 0;
  // 4.3 執念：次の朝に復活する。所持品は遺品として残る。最終局面では発動しない
  if (player.secretTrait === 'tenacity' && !player.secretUsed && !state.finalPhase) {
    player.secretUsed = true;
    player.reviving = true;
  }
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
  if (state.supply && state.supply.x === player.x && state.supply.y === player.y && gained.length > 0) state.supply = null;
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
function chasePath(state: GameState, player: PlayerState, target: { x: number; y: number }, weapon: WeaponDef, budget: number) {
  const { width, height } = state.map;
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
      const step = moveCostOf(state, player, next);
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
  markVisited(state, player);
  const index = cellIndex(state, player.x, player.y);

  // 7.4 救助船に最初に入った人が乗る
  const ship = state.ship;
  if (ship && !ship.gone && state.turn >= ship.arrivesTurn && ship.x === player.x && ship.y === player.y) {
    declareWin(state, player.id, 'ship', events);
    return;
  }

  for (const other of state.players) {
    if (other.id === player.id || !other.alive || other.x !== player.x || other.y !== player.y) continue;
    if (other.hidden || other.playingDead) {
      other.hidden = false;
      other.playingDead = false;
      events.push({ type: 'foundOut', playerId: other.id });
      events.push({ type: 'spotted', playerId: player.id, x: other.x, y: other.y });
    }
  }

  const structure = state.structures[index];
  if (structure?.kind === 'trap' && structure.ownerId !== player.id) {
    const owner = state.players[structure.ownerId];
    const master = owner.secretTrait === 'trap_master';
    delete state.structures[index];
    events.push({ type: 'trapSprung', playerId: structure.ownerId, x: player.x, y: player.y });
    // 6章 警戒していれば罠を見つけられる。罠の名人の罠は見つからない
    if (player.guardTurn === state.turn && !master) {
      events.push({ type: 'trapDisarmed', playerId: player.id });
    } else {
      const damage = TRAP_DAMAGE + (master ? 1 : 0);
      if (master) reveal(owner, events);
      player.hp = Math.max(0, player.hp - damage);
      player.ap = 0;
      events.push({ type: 'trapTriggered', playerId: player.id, damage });
      if (player.hp === 0) {
        eliminate(state, player, events);
        if (!player.alive) return;
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
  const soldier = hasRole(attacker, 'soldier');
  const inFort = state.structures[cellIndex(state, target.x, target.y)]?.kind === 'fort';
  const hitChance =
    weapon.hit +
    (soldier ? SOLDIER.hit : 0) +
    (attacker.cursedTurn === state.turn ? CURSE_HIT : 0) +
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
      (soldier ? SOLDIER.damage : 0) +
      (state.finalPhase ? FINAL.attackBonus : 0) +
      (diagonal ? COMBAT.diagonalDamage : 0) -
      (targetTerrain === 'rock' ? COMBAT.rockDefense : 0) -
      (inFort ? GOALS.fortDefense : 0);
    damage = Math.max(0, Math.max(1, raw) - (guarding ? COMBAT.guardDamage : 0));
    target.hp = Math.max(0, target.hp - damage);
    if (soldier) attacker.progress.warPoints += GOALS.warPerHit;

    // 5章 出血。傷を負わなければ血は出ない
    if (damage > 0 && weapon.bleed > 0 && !target.bleeding && rng.next() < weapon.bleed) {
      target.bleeding = true;
      target.bleedTicks = 0;
      bleeding = true;
    }

    // 8.3 略奪。武器は対象外で、持てなければ奪えない。離れた所からは奪えない
    let candidates = distance <= 1 ? target.inventory.filter((stack) => !WEAPONS[stack.item]) : [];
    // 4.3 隠し財布：1枠だけ奪われない
    if (target.secretTrait === 'hidden_purse' && candidates.length > 0) {
      candidates = candidates.slice(1);
      reveal(target, events);
    }
    if (candidates.length > 0) {
      // 4.3 盗み上手：一番価値のある物を奪う
      const best = attacker.secretTrait === 'pickpocket'
        ? STEAL_PRIORITY.flatMap((item) => candidates.filter((s) => s.item === item))[0]
        : undefined;
      if (attacker.secretTrait === 'pickpocket') reveal(attacker, events);
      const stack = best ?? rng.pick(candidates);
      if (addItem(attacker, stack.item, 1) === 0) {
        stolen = { item: stack.item, count: 1 };
        stack.count -= 1;
        if (stack.count === 0) target.inventory.splice(target.inventory.indexOf(stack), 1);
        // 主を奪われた漁師は、また別の主を狙える
        if (stack.item === 'island_lord') target.progress.lordHeldTurns = 0;
      }
    }

    // 8.1 先手の利。これから手番が来る相手はAPが減る
    const order = state.initiative.map((entry) => entry.playerId);
    if (damage >= COMBAT.firstStrikeDamage && order.indexOf(target.id) > order.indexOf(attacker.id)) {
      target.ap = Math.max(0, target.ap - 1);
    }

    if (target.hp === 0) {
      if (soldier) attacker.progress.warPoints += GOALS.warPerKill;
      target.killerId = attacker.id;
      eliminate(state, target, events);
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
  if (attacker.hp === 0) eliminate(state, attacker, events);
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
  const concealed = target && (target.hidden || target.playingDead);
  const reachable =
    target?.alive && target.id !== playerId && (!concealed || (target.x === player.x && target.y === player.y));

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
  // 動いたことが分かるので、死んだふりも終わる
  if (player.playingDead) {
    player.playingDead = false;
    reveal(player, events);
  }
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

function useItem(state: GameState, player: PlayerState, item: ItemId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const effect = ITEMS[item].use;
  if (!effect || countItem(player, item) === 0) {
    events.push({ type: 'blocked', playerId, reason: 'notOwned' });
    return;
  }
  removeItem(player, item, 1);
  // 4.2 料理人と、鍋・塩があると食料の回復が増える
  const foodBonus = effect.food
    ? (hasRole(player, 'cook') ? 1 : 0) + (hasItem(player, 'pot') ? 1 : 0) + (effect.salted && hasItem(player, 'salt') ? 1 : 0)
    : 0;
  const hunger = Math.min(MAX_HUNGER - player.hunger, (effect.hunger ?? 0) + foodBonus);
  const water = Math.min(MAX_WATER - player.water, effect.water ?? 0);
  const hp = Math.min(player.maxHp - player.hp, effect.hp ?? 0);
  player.hunger += hunger;
  player.water += water;
  player.hp += hp;
  const immune = player.publicTrait === 'iron_stomach' || hasRole(player, 'cook');
  const poisoned = !!effect.risky && !immune && rng.next() < POISON.chance;
  if (poisoned) player.poisonTurns = POISON.turns;
  if (effect.curesPoison) player.poisonTurns = 0;
  // 4.5 医師の作った薬は、誰が使っても医師の治療回数に数える
  if (item === 'medicine') {
    const doctor = state.players.find((p) => p.alive && hasRole(p, 'doctor'));
    if (doctor) doctor.progress.healCount += 1;
  }
  if (effect.winsGame) declareWin(state, player.id, 'cook', events);
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
    case 'hunt':
      return FATIGUE.attack;
    case 'craft':
      return RECIPES[action.recipe].builds ? FATIGUE.build : FATIGUE.craft;
    default:
      return 0;
  }
}

/** 4.2 大工はクラフトと建設のAPが1少ない */
export const recipeAp = (apCost: number, job: JobId | null) => (job === 'carpenter' ? Math.max(1, apCost - 1) : apCost);

/** 2.2 勝者が決まった */
function declareWin(state: GameState, playerId: number, reason: VictoryReason, events: GameEvent[]) {
  // 9.2 最終局面では最後の1人しか勝てない
  if (state.finished || state.finalPhase) return;
  state.finished = true;
  state.winnerId = playerId;
  state.victoryReason = reason;
  events.push({ type: 'victory', playerId, reason });
}

/** 7.4 救助船を呼ぶ。到着地点は呼んだ本人にだけすぐ知らせる */
function callShip(state: GameState, player: PlayerState, rng: Rng, events: GameEvent[]) {
  const { width, terrain } = state.map;
  const beaches = terrain.flatMap((t, i) => (t === 'beach' ? [i] : []));
  if (beaches.length === 0) return;
  const spot = rng.pick(beaches);
  const arrivesTurn = state.turn + SMOKE.shipDelayTurns;
  // 昼に着けば3ターン、夜に着けば2ターン待つ
  const leavesTurn = arrivesTurn + (phaseOf(arrivesTurn) === 'day' ? 2 : 1);
  const x = spot % width;
  const y = Math.floor(spot / width);
  state.ship = { x, y, callerId: player.id, arrivesTurn, leavesTurn };
  events.push({ type: 'shipCalled', playerId: player.id, x, y, arrivesTurn });
}

function craft(state: GameState, player: PlayerState, recipeId: RecipeId, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const recipe = RECIPES[recipeId];
  const apCost = recipeAp(recipe.ap, player.job);
  if (player.ap < apCost) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
    return;
  }
  const index = cellIndex(state, player.x, player.y);
  // 職業専用のレシピと、建てる場所の決まり
  const wrongJob = recipe.job && !hasRole(player, recipe.job);
  const wrongPlace = recipe.onTerrain && state.map.terrain[index] !== recipe.onTerrain;
  const smokeBlocked =
    recipe.builds === 'smoke' &&
    (state.ship !== null ||
      state.turn < SMOKE.firstTurn ||
      state.turn > SMOKE.lastTurn ||
      (state.world && state.weather === 'rain'));
  if (wrongJob || wrongPlace || smokeBlocked) {
    events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
    return;
  }
  const counts = new Map<ItemId, number>();
  for (const stack of player.inventory) counts.set(stack.item, (counts.get(stack.item) ?? 0) + stack.count);
  const inputs = recipe.course
    ? courseIngredients(counts)
    : recipe.inputs.find((set) => set.every(({ item, count }) => countItem(player, item) >= count));
  if (!inputs) {
    events.push({ type: 'blocked', playerId, reason: 'missingMaterials' });
    return;
  }
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
  player.ap -= apCost;
  if (recipe.builds) state.structures[index] = { kind: recipe.builds, ownerId: playerId };
  events.push({ type: 'crafted', playerId, recipe: recipeId, gained: recipe.output ? [recipe.output] : [], lost: [] });
  if (recipe.builds === 'fort') {
    const fort = state.structures[index];
    fort.hp = GOALS.fortHp;
    fort.builtTurn = state.turn;
    events.push({ type: 'fortCompleted' });
  }
  if (recipe.builds === 'smoke') {
    events.push({ type: 'smokeLit', x: player.x, y: player.y });
    callShip(state, player, rng, events);
  }
  // 出血しているなら、作った包帯をそのまま巻く
  if (recipe.output && ITEMS[recipe.output.item].use?.stopsBleeding && player.bleeding) {
    useItem(state, player, recipe.output.item, rng, events);
  }
}

/** 4.2 医師の治療。同じマスの相手に効く */
function heal(state: GameState, player: PlayerState, targetId: number, events: GameEvent[]) {
  const playerId = player.id;
  const target = state.players[targetId];
  if (!hasRole(player, 'doctor')) {
    events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
  } else if (player.ap < HEAL_AP) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
  } else if (!target?.alive || target.id === playerId || target.x !== player.x || target.y !== player.y) {
    player.ap -= HEAL_AP;
    events.push({ type: 'healed', playerId, targetId: null, hp: 0, maxHpUp: false });
  } else {
    player.ap -= HEAL_AP;
    const dying = target.hp === 1;
    const maxHpUp = !target.treatedOnce;
    if (maxHpUp) {
      target.treatedOnce = true;
      target.maxHp += 1;
    }
    const hp = Math.min(target.maxHp - target.hp, GOALS.healAmount);
    target.hp += hp;
    target.bleeding = false;
    target.bleedTicks = 0;
    target.poisonTurns = 0;
    // 4.5 同じ相手は2回まで。脱落直前の相手は2回分
    const p = player.progress;
    const done = p.healedBy[targetId] ?? 0;
    const counted = Math.min(GOALS.healPerTarget - done, dying ? 2 : 1);
    if (counted > 0) {
      p.healedBy[targetId] = done + counted;
      p.healCount += counted;
    }
    events.push({ type: 'healed', playerId, targetId, hp, maxHpUp });
    events.push({ type: 'wasHealed', playerId: targetId, hp, maxHpUp });
  }
}

/** 7.3 いかだの素材を運び込む。なければ砂浜で作り始める */
function raftWork(state: GameState, player: PlayerState, events: GameEvent[]) {
  const playerId = player.id;
  const index = cellIndex(state, player.x, player.y);
  const apCost = recipeAp(RAFT.ap, player.job);
  const existing = state.structures[index];
  if (state.map.terrain[index] !== 'beach' || (existing && (existing.kind !== 'raft' || existing.ownerId !== playerId))) {
    events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
    return;
  }
  if (player.ap < apCost) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
    return;
  }
  const raft = existing ?? { kind: 'raft' as const, ownerId: playerId, hp: RAFT.hp, stock: [] as ItemStack[] };
  const stored: ItemStack[] = [];
  for (const need of RAFT.needs) {
    const have = raft.stock!.find((s) => s.item === need.item);
    const missing = need.count - (have?.count ?? 0);
    const moved = Math.min(missing, countItem(player, need.item));
    if (moved <= 0) continue;
    removeItem(player, need.item, moved);
    if (have) have.count += moved;
    else raft.stock!.push({ item: need.item, count: moved });
    stored.push({ item: need.item, count: moved });
  }
  if (stored.length === 0 && !existing) {
    events.push({ type: 'blocked', playerId, reason: 'missingMaterials' });
    return;
  }
  state.structures[index] = raft;
  player.ap -= apCost;
  events.push({ type: 'raftWorked', playerId, complete: raftComplete(raft), stored });
}

const raftComplete = (raft: Structure) =>
  RAFT.needs.every((need) => (raft.stock ?? []).some((s) => s.item === need.item && s.count >= need.count));

/** 7.3 砦やいかだを壊す。いかだが壊れると素材の半分が残る */
function smash(state: GameState, player: PlayerState, rng: Rng, events: GameEvent[]) {
  const playerId = player.id;
  const index = cellIndex(state, player.x, player.y);
  const target = state.structures[index];
  if (!target || (target.kind !== 'fort' && target.kind !== 'raft')) {
    events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
    return;
  }
  if (player.ap < ATTACK_AP) {
    events.push({ type: 'blocked', playerId, reason: 'noAp' });
    return;
  }
  player.ap -= ATTACK_AP;
  const weapon = weaponsBestFirst(player, false)[0];
  const damage = (weapon.rollsD3 ? rng.int(1, 3) : 0) + weapon.bonus + (hasRole(player, 'soldier') ? SOLDIER.damage : 0);
  target.hp = Math.max(0, (target.hp ?? 0) - damage);
  const destroyed = target.hp === 0;
  events.push({ type: 'smashed', playerId, kind: target.kind, hp: target.hp, destroyed });
  if (!destroyed) return;
  delete state.structures[index];
  if (target.kind === 'fort') events.push({ type: 'fortDestroyed' });
  else {
    const left = (target.stock ?? [])
      .map((s) => ({ item: s.item, count: Math.floor(s.count / 2) }))
      .filter((s) => s.count > 0);
    if (left.length > 0) state.relics[index] = [...(state.relics[index] ?? []), ...left];
  }
}

/** 4.3 読心術。1回だけ他人の予約を覗ける。発動した瞬間に公開される */
export function useMindRead(previous: GameState, playerId: number, targetId: number): { state: GameState; events: GameEvent[] } | null {
  const me = previous.players[playerId];
  const target = previous.players[targetId];
  if (me?.secretTrait !== 'mind_reader' || me.secretUsed || !target?.alive || targetId === playerId) return null;
  const state: GameState = JSON.parse(JSON.stringify(previous));
  const player = state.players[playerId];
  player.secretUsed = true;
  const events: GameEvent[] = [];
  reveal(player, events);
  return { state, events };
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
    state.scouts = state.scouts.filter((scout) => scout.untilTurn >= state.turn);
    if (state.world) startOfTurn(state, rng, events);
    for (const player of state.players) {
      // 4.3 執念：次の朝にランダムな砂浜で復活する
      if (!player.alive && player.reviving && isDay) {
        const beaches = state.map.terrain.flatMap((t, i) => (t === 'beach' ? [i] : []));
        const spot = rng.pick(beaches);
        player.x = spot % state.map.width;
        player.y = Math.floor(spot / state.map.width);
        player.alive = true;
        player.reviving = false;
        player.hp = TENACITY_HP;
        reveal(player, events);
        events.push({ type: 'playerRevived', playerId: player.id });
      }
      if (!player.alive) continue;
      if (isDay) {
        player.hunger = Math.max(0, player.hunger - (player.publicTrait === 'big_eater' ? 2 : 1));
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
          eliminate(state, player, events);
          if (!player.alive) continue;
        }
      }
      // 4.3 早起きは発動した日に公開
      if (isDay && player.secretTrait === 'early_riser') reveal(player, events);
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
    // 7.4 救助船。到着の1ターン前に全員へ公開する
    const previousOrder = state.initiative.map((entry) => entry.playerId);
    const ship = state.ship;
    if (ship && !ship.gone) {
      if (state.turn === ship.arrivesTurn - 1) events.push({ type: 'shipSoon', x: ship.x, y: ship.y });
      if (state.turn === ship.arrivesTurn) {
        events.push({ type: 'shipArrived', x: ship.x, y: ship.y });
        // すでにそのマスにいる人は、行動順の早い人から乗る
        const aboard = previousOrder.map((id) => state.players[id]).find(
          (p) => p?.alive && p.x === ship.x && p.y === ship.y,
        );
        if (aboard) declareWin(state, aboard.id, 'ship', events);
      }
      if (state.turn > ship.leavesTurn) {
        ship.gone = true;
        events.push({ type: 'shipLeft' });
      }
    }
    state.initiative = rollInitiative(state.players, rng, state.turn);
    state.rngState = rng.state;
    events.push({ type: 'turnStarted', turn: state.turn, day: dayOf(state.turn), phase: phaseOf(state.turn) });
    return { state, events };
  }

  const player = state.players[action.playerId];
  const playerId = player.id;
  // 8.5 幽霊にできること
  if (!player.alive) {
    if (action.type === 'haunt') haunt(state, player, action.kind, action.x, action.y, events);
    else if (action.type === 'curse' && !player.curseUsed && player.killerId !== null) {
      player.curseUsed = true;
      state.players[player.killerId].cursedTurn = state.turn + 1;
      events.push({ type: 'cursed', playerId });
    } else events.push({ type: 'blocked', playerId, reason: 'eliminated' });
    return { state, events };
  }
  const apBefore = player.ap;

  switch (action.type) {
    case 'move': {
      // 4.3 方向音痴はときどき違う方へ進む。コンパスがあれば迷わない
      let direction = action.direction;
      if (player.secretTrait === 'lost_sense' && !hasItem(player, 'compass') && rng.next() < LOST_SENSE_DRIFT) {
        direction = rng.pick((Object.keys(DIRECTION_DELTA) as Direction[]).filter((d) => d !== action.direction));
        reveal(player, events);
      }
      const [dx, dy] = DIRECTION_DELTA[direction];
      const x = player.x + dx;
      const y = player.y + dy;
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
        events.push({ type: 'blocked', playerId, reason: 'sea' });
        break;
      }
      const index = cellIndex(state, x, y);
      const terrain = state.map.terrain[index];
      const baseCost = moveCostOf(state, player, index);
      // 4.3 健脚：草原と砂浜の移動が1ターンに1回無料
      const free =
        player.publicTrait === 'swift_feet' &&
        (terrain === 'grass' || terrain === 'beach') &&
        player.freeMoveTurn !== state.turn;
      const cost = baseCost === null ? null : free ? 0 : baseCost;
      if (free && cost !== null) player.freeMoveTurn = state.turn;
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
      useItem(state, player, action.item, rng, events);
      break;
    case 'hunt': {
      const npc = state.npcs.find((n) => n.id === action.npcId);
      if (player.ap < HUNT_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      const weapon = weaponsBestFirst(player, phaseOf(state.turn) === 'night').find(
        (w) => npc && chasePath(state, player, npc, w, player.ap - HUNT_AP),
      );
      const path = npc && weapon ? chasePath(state, player, npc, weapon, player.ap - HUNT_AP) : null;
      if (!npc || !weapon || !path) {
        player.ap -= HUNT_AP;
        events.push({ type: 'attackFizzled', playerId });
        break;
      }
      for (const index of path) {
        const terrain = state.map.terrain[index];
        const cost = moveCostOf(state, player, index)!;
        player.x = index % state.map.width;
        player.y = Math.floor(index / state.map.width);
        player.ap -= cost;
        refreshMemory(state, player);
        events.push({ type: 'moved', playerId, x: player.x, y: player.y, terrain, cost });
        arrive(state, player, rng, events);
        if (!player.alive || player.ap < HUNT_AP) break;
      }
      if (!player.alive || player.ap < HUNT_AP) break;
      player.ap -= HUNT_AP;
      player.hidden = false;
      const damage =
        (weapon.rollsD3 ? rng.int(1, 3) : 0) + weapon.bonus + (hasRole(player, 'soldier') ? SOLDIER.damage : 0);
      const hit = weapon.hit + (hasRole(player, 'soldier') ? SOLDIER.hit : 0);
      huntNpc(state, player, npc, hit, damage, rng, events);
      break;
    }
    case 'aid': {
      const npc = state.npcs.find((n) => n.id === action.npcId);
      const here = npc && npc.x === player.x && npc.y === player.y && npc.kind === 'castaway' && npc.followerOf == null;
      if (!here) events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      else if (player.ap < AID_AP) events.push({ type: 'blocked', playerId, reason: 'noAp' });
      else if (aidNpc(player, npc, rng, events)) player.ap -= AID_AP;
      else events.push({ type: 'blocked', playerId, reason: 'missingMaterials' });
      break;
    }
    case 'heal':
      heal(state, player, action.targetId, events);
      break;
    case 'explore': {
      if (player.ap < EXPLORE_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      player.ap -= EXPLORE_AP;
      player.exploreTurn = state.turn;
      refreshMemory(state, player);
      markVisited(state, player);
      events.push({ type: 'explored', playerId });
      break;
    }
    case 'repair': {
      const fort = state.structures[cellIndex(state, player.x, player.y)];
      if (fort?.kind !== 'fort' || !hasRole(player, 'carpenter') || player.repairedTurn === state.turn) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else if (player.ap < REPAIR_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= REPAIR_AP;
        player.repairedTurn = state.turn;
        fort.hp = Math.min(GOALS.fortHp, (fort.hp ?? 0) + GOALS.fortRepair);
        events.push({ type: 'repaired', playerId, hp: fort.hp });
      }
      break;
    }
    case 'smash':
      smash(state, player, rng, events);
      break;
    case 'extinguish': {
      const index = cellIndex(state, player.x, player.y);
      if (state.structures[index]?.kind !== 'smoke') {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else if (player.ap < SMOKE.extinguishAp) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= SMOKE.extinguishAp;
        delete state.structures[index];
        // 船が着く前に消せば来なくなる
        if (state.ship && state.turn < state.ship.arrivesTurn) state.ship = null;
        events.push({ type: 'smokeOut' });
      }
      break;
    }
    case 'raftWork':
      raftWork(state, player, events);
      break;
    case 'launch': {
      const raft = state.structures[cellIndex(state, player.x, player.y)];
      if (raft?.kind !== 'raft' || raft.ownerId !== playerId || !raftComplete(raft)) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else if (player.ap < 1) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= 1;
        declareWin(state, playerId, 'raft', events);
      }
      break;
    }
    case 'useRadio': {
      const onMountain = state.map.terrain[cellIndex(state, player.x, player.y)] === 'mountain';
      if (player.secretTrait !== 'radio' || player.secretUsed) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else if (!player.radioFixed) {
        if (!onMountain) events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
        else if (player.ap < SMOKE.radioRepairAp) events.push({ type: 'blocked', playerId, reason: 'noAp' });
        else {
          player.ap -= SMOKE.radioRepairAp;
          player.radioFixed = true;
          events.push({ type: 'radioFixed', playerId });
        }
      } else if (state.ship !== null) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else if (player.ap < SMOKE.radioCallAp) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        player.ap -= SMOKE.radioCallAp;
        player.secretUsed = true;
        callShip(state, player, rng, events);
      }
      break;
    }
    case 'scout': {
      const day = dayOf(state.turn);
      const { width, height } = state.map;
      if (player.publicTrait !== 'hawk_eye' || player.scoutDay === day) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
        break;
      }
      player.scoutDay = day;
      const cells: number[] = [];
      for (let y = Math.max(0, action.y - 1); y <= Math.min(height - 1, action.y + 1); y++) {
        for (let x = Math.max(0, action.x - 1); x <= Math.min(width - 1, action.x + 1); x++) {
          cells.push(y * width + x);
          player.memory[y * width + x] = state.map.terrain[y * width + x];
        }
      }
      state.scouts.push({ playerId, cells, untilTurn: state.turn + 1 });
      events.push({ type: 'scouted', playerId });
      break;
    }
    case 'falseAlarm': {
      if (player.secretTrait !== 'false_alarm' || player.secretUsed) {
        events.push({ type: 'blocked', playerId, reason: 'notAllowed' });
      } else {
        player.secretUsed = true;
        events.push({ type: 'nearVictory' });
      }
      break;
    }
    case 'craft':
      craft(state, player, action.recipe, rng, events);
      break;
    case 'rest': {
      if (player.ap <= 0) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
        break;
      }
      const inHut = state.structures[cellIndex(state, player.x, player.y)]?.kind === 'hut';
      // 9.2 最終局面では休息で回復しない
      const healed = state.finalPhase ? 0 : Math.min(player.maxHp - player.hp, player.ap * (inHut ? REST_HUT_MULTIPLIER : 1));
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
      } else if (state.finalPhase || !TERRAIN[state.map.terrain[cellIndex(state, player.x, player.y)]].canHide) {
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
      // 4.3 人望：1日に1回APを使わずに密談できる
      const free = player.publicTrait === 'respected' && player.freeWhisperDay !== dayOf(state.turn);
      if (!free && player.ap < WHISPER_AP) {
        events.push({ type: 'blocked', playerId, reason: 'noAp' });
      } else {
        if (free) player.freeWhisperDay = dayOf(state.turn);
        else player.ap -= WHISPER_AP;
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
        if (action.type === 'heal') return { type: 'heal', playerId, targetId: targetOf(playerId, action) };
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

  // 8.5 幽霊の怪異は解決の最初に起きる
  for (const ghost of previous.players) {
    if (ghost.alive) continue;
    for (const action of plans[ghost.id] ?? []) {
      if (action.type !== 'haunt' && action.type !== 'curse') continue;
      const result = applyAction(state, { ...action, playerId: ghost.id });
      state = result.state;
      steps.push({ actorId: ghost.id, events: result.events, state });
    }
  }

  /** 特殊勝利の条件を満たしていれば確定する */
  const settleVictory = () => {
    const found = findWinner(state);
    if (!found) return false;
    state = JSON.parse(JSON.stringify(state)) as GameState;
    const events: GameEvent[] = [];
    declareWin(state, found.playerId, found.reason, events);
    steps.push({ actorId: null, events, state });
    return true;
  };
  const finishWith = () => {
    steps.push({ actorId: null, events: [{ type: 'gameFinished', winnerId: state.winnerId }], state });
  };

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
      // 誰かがその場で勝った（船に乗った、いかだで出た、フルコースを食べた）
      if (state.finished || (!state.finalPhase && settleVictory())) {
        finishWith();
        return { state, steps };
      }
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

  // 9.1 解決の最後に動物が動く。9.2 沈んだマスに残っていると脱落する
  if (state.world) {
    state = JSON.parse(JSON.stringify(state)) as GameState;
    const rng = new Rng(state.rngState);
    const worldEvents: GameEvent[] = [];
    const before = state.players.map((p) => p.alive);
    moveNpcs(state, rng, worldEvents);
    drownCheck(state, worldEvents);
    state.players.forEach((player, id) => {
      if (before[id] && !player.alive) worldEvents.push({ type: 'playerEliminated', playerId: id });
    });
    state.rngState = rng.state;
    if (worldEvents.length > 0) steps.push({ actorId: null, events: worldEvents, state });
  }

  // 終了フェーズ。最後の1人（執念で復活を待つ人は数に入れる）
  const finish = () => {
    if (state.finished) {
      finishWith();
      return true;
    }
    const alive = state.players.filter((player) => player.alive || player.reviving);
    const lastOneStanding = state.players.length > 1 && alive.length === 1;
    if (!lastOneStanding && alive.length > 0) return false;
    state = JSON.parse(JSON.stringify(state)) as GameState;
    state.finished = true;
    state.winnerId = lastOneStanding ? alive[0].id : null;
    state.victoryReason = lastOneStanding ? 'lastStanding' : null;
    // 9.2 全員が同時に倒れたら、直前のHPが高い人の勝ち。同じなら進み具合が大きい人
    if (alive.length === 0 && state.finalPhase) {
      const score = (p: PlayerState) => p.hpAtTurnStart * 1000 + p.progress.explored.length + p.progress.warPoints * 10 + p.progress.healCount * 10;
      const best = [...state.players].sort((a, b) => score(b) - score(a))[0];
      state.winnerId = best.id;
      state.victoryReason = 'lastStanding';
    }
    finishWith();
    return true;
  };
  if (finish()) return { state, steps };

  // 4.5 島の主を持ったまま過ごしたターンを数える
  state = JSON.parse(JSON.stringify(state)) as GameState;
  for (const player of state.players) {
    if (player.alive && hasItem(player, 'island_lord')) player.progress.lordHeldTurns += 1;
  }

  const before = state;
  const next = applyAction(state, { type: 'endTurn' });
  state = next.state;
  const events = [...next.events];
  for (const player of state.players) {
    if (before.players[player.id].alive && !player.alive) {
      events.push({ type: 'playerEliminated', playerId: player.id });
    }
  }
  // 4.5 あと1歩の人がいれば、誰かは伏せて全員に知らせる
  for (const player of state.players) {
    if (!state.nearNotified.includes(player.id) && isNearVictory(state, player)) {
      state.nearNotified.push(player.id);
      events.push({ type: 'nearVictory' });
    }
  }
  steps.push({ actorId: null, events, state });
  if (!state.finished && !state.finalPhase && settleVictory()) {
    finishWith();
    return { state, steps };
  }
  finish();
  return { state, steps };
}
