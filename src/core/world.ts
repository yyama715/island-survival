// 9章 天候、イベント、動物、潮位上昇、最終局面。8.5 幽霊。
import {
  BOAR,
  CASTAWAY_REWARDS,
  CRITTER_RESPAWN_TURNS,
  FINAL,
  FOLLOW_TURNS,
  FOOTPRINT_TURNS,
  HERD_DAMAGE,
  NEST_HIT_BONUS,
  NPC_HP,
  NPC_MAX,
  NPC_MEAT,
  SUPPLY_ITEMS,
  WEATHER,
} from './data';
import { cellIndex, dayOf, eliminate, hasItem, phaseOf, receive } from './game';
import type { Rng } from './rng';
import { hasRole } from './victory';
import type { GameEvent, GameState, HauntKind, Npc, NpcKind, PlayerState, TerrainId, Weather } from './types';

const DIRS = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;

const landCells = (state: GameState, wanted?: (t: TerrainId) => boolean) =>
  state.map.terrain.flatMap((t, i) => (t !== 'sea' && (!wanted || wanted(t)) ? [i] : []));

const toPoint = (state: GameState, index: number) => ({
  x: index % state.map.width,
  y: Math.floor(index / state.map.width),
});

const countNpc = (state: GameState, kind: NpcKind) => state.npcs.filter((n) => n.kind === kind).length;

function spawn(state: GameState, kind: NpcKind, index: number, extra: Partial<Npc> = {}): Npc {
  const npc: Npc = { id: state.nextNpcId++, kind, ...toPoint(state, index), hp: NPC_HP[kind], ...extra };
  state.npcs.push(npc);
  return npc;
}

/** ゲーム開始時の動物 */
export function seedAnimals(state: GameState, rng: Rng) {
  const grass = landCells(state, (t) => t === 'grass');
  const forest = landCells(state, (t) => t === 'forest');
  for (let i = 0; i < 3 && grass.length > 0; i++) spawn(state, 'critter', rng.pick(grass));
  if (forest.length > 0) spawn(state, 'monkey', rng.pick(forest));
}

function rollWeather(rng: Rng): Weather {
  const { sunny, rain, storm } = WEATHER.weights;
  const roll = rng.next() * (sunny + rain + storm);
  return roll < sunny ? 'sunny' : roll < sunny + rain ? 'rain' : 'storm';
}

const inShelter = (state: GameState, player: PlayerState) => {
  const kind = state.structures[cellIndex(state, player.x, player.y)]?.kind;
  return kind === 'hut' || kind === 'fort';
};

function damage(state: GameState, player: PlayerState, amount: number, events: GameEvent[]) {
  player.hp = Math.max(0, player.hp - amount);
  if (player.hp === 0) eliminate(state, player, events);
}

/** マスを沈める。乗っている人は最終局面でなければ隣の陸へ押し出す */
function sink(state: GameState, cells: number[], push: boolean) {
  for (const cell of cells) {
    state.map.terrain[cell] = 'sea';
    state.sunk.push(cell);
    delete state.structures[cell];
    delete state.relics[cell];
    state.npcs = state.npcs.filter((npc) => cellIndex(state, npc.x, npc.y) !== cell);
    if (!push) continue;
    const { x, y } = toPoint(state, cell);
    for (const player of state.players) {
      if (!player.alive || player.x !== x || player.y !== y) continue;
      for (const [dx, dy] of DIRS) {
        const next = cellIndex(state, x + dx, y + dy);
        if (state.map.terrain[next] && state.map.terrain[next] !== 'sea') {
          player.x = x + dx;
          player.y = y + dy;
          break;
        }
      }
    }
  }
}

/** 9.2 外側の陸地を1周。一番高いマスは最後まで残す */
function nextRing(state: GameState): number[] {
  const land = landCells(state);
  if (land.length <= 1) return [];
  const peak = land.reduce((best, cell) => (state.map.elevation[cell] > state.map.elevation[best] ? cell : best));
  const ring = land.filter((cell) => {
    if (cell === peak) return false;
    const { x, y } = toPoint(state, cell);
    return DIRS.some(([dx, dy]) => state.map.terrain[cellIndex(state, x + dx, y + dy)] === 'sea');
  });
  return ring.length > 0 ? ring : land.filter((cell) => cell !== peak);
}

function randomEvent(state: GameState, rng: Rng, events: GameEvent[]) {
  const beaches = landCells(state, (t) => t === 'beach').filter((c) => !state.sinkNext.includes(c));
  const forests = landCells(state, (t) => t === 'forest');
  const options: (() => void)[] = [];
  if (beaches.length > 0 && !state.supply) {
    options.push(() => {
      const cell = rng.pick(beaches);
      state.relics[cell] = [...(state.relics[cell] ?? []), { ...rng.pick(SUPPLY_ITEMS) }];
      state.supply = toPoint(state, cell);
      events.push({ type: 'supplyDropped', ...state.supply });
    });
  }
  if (beaches.length > 0 && countNpc(state, 'castaway') < NPC_MAX.castaway) {
    options.push(() => {
      const npc = spawn(state, 'castaway', rng.pick(beaches), { followerOf: null });
      events.push({ type: 'castawayAppeared', x: npc.x, y: npc.y });
    });
  }
  if (forests.length > 0 && countNpc(state, 'boar') < NPC_MAX.boar) {
    options.push(() => {
      const cell = rng.pick(forests);
      const { x, y } = toPoint(state, cell);
      spawn(state, 'boar', cell, { homeX: x, homeY: y });
      events.push({ type: 'boarAppeared' });
    });
  }
  if (countNpc(state, 'herd') < NPC_MAX.herd && beaches.length > 0) {
    options.push(() => {
      const cell = rng.pick(beaches);
      const { x, y } = toPoint(state, cell);
      // 島の中心へ向かって進む
      const center = (state.map.width - 1) / 2;
      const horizontal = Math.abs(x - center) > Math.abs(y - center);
      spawn(state, 'herd', cell, {
        dx: horizontal ? (x < center ? 1 : -1) : 0,
        dy: horizontal ? 0 : y < center ? 1 : -1,
      });
      events.push({ type: 'herdAppeared' });
    });
  }
  options.push(() => {
    // 地震：いくつかの地形が変わる。既知マスの記憶は古くなる
    const changeable = landCells(state, (t) => t === 'grass' || t === 'forest' || t === 'rock');
    for (let i = 0; i < 3 && changeable.length > 0; i++) {
      state.map.terrain[rng.pick(changeable)] = rng.pick<TerrainId>(['grass', 'rock', 'forest']);
    }
    events.push({ type: 'quake' });
  });
  rng.pick(options)();
}

/** 2.4 開始フェーズの世界の変化。プレイヤーの飢えなどより先に動く */
export function startOfTurn(state: GameState, rng: Rng, events: GameEvent[]) {
  const isDay = phaseOf(state.turn) === 'day';
  state.fog = state.fog.filter((f) => f.untilTurn >= state.turn);
  state.blessed = state.blessed.filter((b) => b.untilTurn >= state.turn);
  state.footprints = state.footprints.filter((f) => f.untilTurn >= state.turn);
  for (const player of state.players) player.hpAtTurnStart = player.hp;

  // 9.2 最終局面に入る
  if (!state.finalPhase && state.turn >= FINAL.startTurn) {
    state.finalPhase = true;
    state.weather = 'storm';
    state.sinkNext = nextRing(state);
    if (state.ship) state.ship.gone = true;
    for (const player of state.players) player.hidden = false;
    events.push({ type: 'finalStarted' });
    return;
  }

  if (state.finalPhase) {
    if (state.sinkNext.length > 0) {
      const cells = state.sinkNext;
      sink(state, cells, false);
      events.push({ type: 'finalSunk', cells: cells.length });
    }
    state.sinkNext = nextRing(state);
    for (const player of state.players) {
      if (!player.alive || inShelter(state, player)) continue;
      damage(state, player, FINAL.stormDamage, events);
      if (player.alive) events.push({ type: 'weatherHit', playerId: player.id, damage: FINAL.stormDamage, water: 0 });
    }
    for (const [cell, structure] of Object.entries(state.structures)) {
      if (structure.kind !== 'hut' && structure.kind !== 'fort') continue;
      structure.hp = (structure.hp ?? FINAL.hutHp) - FINAL.buildingDamage;
      if (structure.hp <= 0) delete state.structures[Number(cell)];
    }
    return;
  }

  // 小動物の復活
  const ready = state.critterRespawns.filter((turn) => turn <= state.turn);
  state.critterRespawns = state.critterRespawns.filter((turn) => turn > state.turn);
  const grass = landCells(state, (t) => t === 'grass');
  for (const _ of ready) {
    if (grass.length > 0 && countNpc(state, 'critter') < NPC_MAX.critter) spawn(state, 'critter', rng.pick(grass));
  }

  if (!isDay) return;
  // 9章 毎日の始まりに天候とイベント
  state.weather = rollWeather(rng);
  events.push({ type: 'weatherChanged', weather: state.weather });
  for (const player of state.players) {
    if (!player.alive) continue;
    if (state.weather === 'sunny' && player.publicTrait !== 'heat_proof') {
      player.water = Math.max(0, player.water - WEATHER.sunnyWater);
    } else if (state.weather === 'rain') {
      player.water = Math.min(10, player.water + WEATHER.rainWater);
      events.push({ type: 'weatherHit', playerId: player.id, damage: 0, water: WEATHER.rainWater });
    } else if (state.weather === 'storm' && !inShelter(state, player)) {
      damage(state, player, WEATHER.stormDamage, events);
      if (player.alive) events.push({ type: 'weatherHit', playerId: player.id, damage: WEATHER.stormDamage, water: 0 });
    }
  }
  // 7.4 嵐の日に上げた狼煙は消える
  if (state.weather === 'storm') {
    for (const [cell, structure] of Object.entries(state.structures)) {
      if (structure.kind !== 'smoke') continue;
      delete state.structures[Number(cell)];
      if (state.ship && state.turn < state.ship.arrivesTurn) state.ship = null;
      events.push({ type: 'smokeOut' });
    }
  }

  // 9章 潮位上昇。砂浜が1日1か所ずつ沈み、前の日に予告する
  if (state.sinkNext.length > 0) {
    sink(state, state.sinkNext, true);
    state.sinkNext = [];
    events.push({ type: 'tideRose' });
  }
  if (dayOf(state.turn) >= WEATHER.tideStartDay) {
    const beaches = landCells(state, (t) => t === 'beach');
    if (beaches.length > 0) {
      const next = rng.pick(beaches);
      state.sinkNext = [next];
      events.push({ type: 'tideNotice', ...toPoint(state, next) });
    }
  }

  if (rng.next() < WEATHER.eventChance) randomEvent(state, rng, events);
}

const walkable = (state: GameState, x: number, y: number, kind: NpcKind) => {
  const terrain = state.map.terrain[cellIndex(state, x, y)];
  if (!terrain || terrain === 'sea') return false;
  // 9.1 動物は海と山には入らない
  return kind === 'herd' || terrain !== 'mountain';
};

function stepNpc(state: GameState, npc: Npc, options: (readonly [number, number])[]) {
  const cell = cellIndex(state, npc.x, npc.y);
  const open = options.filter(([dx, dy]) => walkable(state, npc.x + dx, npc.y + dy, npc.kind));
  if (open.length === 0) return false;
  state.footprints.push({ cell, untilTurn: state.turn + FOOTPRINT_TURNS });
  const [dx, dy] = open[0];
  npc.x += dx;
  npc.y += dy;
  return true;
}

const towards = (npc: Npc, x: number, y: number) =>
  [...DIRS].sort(
    (a, b) => Math.abs(npc.x + a[0] - x) + Math.abs(npc.y + a[1] - y) - (Math.abs(npc.x + b[0] - x) + Math.abs(npc.y + b[1] - y)),
  );

const shuffledDirs = (rng: Rng) => rng.shuffled(DIRS);

const distance = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/** 解決フェーズの最後に動物が動く */
export function moveNpcs(state: GameState, rng: Rng, events: GameEvent[]) {
  const alive = () => state.players.filter((p) => p.alive);
  for (const npc of [...state.npcs]) {
    if (npc.kind === 'critter') {
      const near = alive().find((p) => distance(p.x, p.y, npc.x, npc.y) <= 1);
      if (near) {
        // 臆病なので逃げる
        const away = [...DIRS].sort(
          (a, b) => distance(npc.x + b[0], npc.y + b[1], near.x, near.y) - distance(npc.x + a[0], npc.y + a[1], near.x, near.y),
        );
        stepNpc(state, npc, away);
      } else {
        stepNpc(state, npc, shuffledDirs(rng));
      }
    } else if (npc.kind === 'monkey') {
      const carrier = !npc.carried && alive().find(
        (p) => distance(p.x, p.y, npc.x, npc.y) <= 3 && p.secretTrait !== 'beast_friend' && p.inventory.some((s) => s.item === 'fruit' || s.item === 'nut' || s.item === 'honey' || s.item === 'meat' || s.item === 'fish'),
      );
      if (carrier) stepNpc(state, npc, towards(npc, carrier.x, carrier.y));
      else stepNpc(state, npc, shuffledDirs(rng));
      if (carrier && carrier.x === npc.x && carrier.y === npc.y) {
        const stack = carrier.inventory.find((s) => ['fruit', 'nut', 'honey', 'meat', 'fish'].includes(s.item));
        if (stack) {
          stack.count -= 1;
          npc.carried = { item: stack.item, count: 1 };
          events.push({ type: 'monkeyStole', playerId: carrier.id, item: stack.item });
          if (stack.count === 0) carrier.inventory.splice(carrier.inventory.indexOf(stack), 1);
        }
      }
    } else if (npc.kind === 'boar') {
      if (npc.fledUntil && state.turn < npc.fledUntil) continue;
      if (npc.fledUntil) {
        npc.fledUntil = undefined;
        npc.hp = NPC_HP.boar;
      }
      const steps = phaseOf(state.turn) === 'day' ? 1 : 2;
      for (let s = 0; s < steps; s++) {
        const prey = alive().find(
          (p) => distance(p.x, p.y, npc.homeX!, npc.homeY!) <= BOAR.territory && distance(p.x, p.y, npc.x, npc.y) <= 3,
        );
        const inTerritory = (d: readonly [number, number]) => distance(npc.x + d[0], npc.y + d[1], npc.homeX!, npc.homeY!) <= BOAR.territory;
        const moves = prey ? towards(npc, prey.x, prey.y).filter(inTerritory) : shuffledDirs(rng).filter(inTerritory);
        stepNpc(state, npc, moves);
      }
      // 縄張りに入った人へ突進する
      const target = alive().find(
        (p) => distance(p.x, p.y, npc.x, npc.y) <= 1 && distance(p.x, p.y, npc.homeX!, npc.homeY!) <= BOAR.territory,
      );
      if (target) {
        const chance = BOAR.hit + (target.secretTrait === 'beast_friend' ? BOAR.friendHit : 0);
        if (rng.next() < chance) {
          damage(state, target, BOAR.damage, events);
          events.push({ type: 'npcHit', playerId: target.id, kind: 'boar', damage: BOAR.damage });
        }
      }
    } else if (npc.kind === 'herd') {
      const moved = stepNpc(state, npc, [[npc.dx ?? 0, npc.dy ?? 0]]);
      if (!moved) {
        state.npcs = state.npcs.filter((n) => n !== npc);
        continue;
      }
      for (const player of alive()) {
        if (player.x === npc.x && player.y === npc.y) {
          damage(state, player, HERD_DAMAGE, events);
          events.push({ type: 'npcHit', playerId: player.id, kind: 'herd', damage: HERD_DAMAGE });
        }
      }
    } else if (npc.kind === 'castaway') {
      if (npc.followerOf !== null && npc.followerOf !== undefined) {
        const leader = state.players[npc.followerOf];
        npc.followTurns = (npc.followTurns ?? 0) - 1;
        if (!leader.alive || npc.followTurns <= 0) {
          state.npcs = state.npcs.filter((n) => n !== npc);
          continue;
        }
        npc.x = leader.x;
        npc.y = leader.y;
      } else {
        npc.hp -= 1;
        if (npc.hp <= 0) {
          const cell = cellIndex(state, npc.x, npc.y);
          state.relics[cell] = [...(state.relics[cell] ?? []), { ...rng.pick(CASTAWAY_REWARDS) }];
          state.npcs = state.npcs.filter((n) => n !== npc);
        }
      }
    }
  }
}

/** 9.2 沈んだマスに残っていると脱落する */
export function drownCheck(state: GameState, events: GameEvent[]) {
  for (const player of state.players) {
    if (!player.alive) continue;
    if (state.map.terrain[cellIndex(state, player.x, player.y)] !== 'sea') continue;
    // 泳ぎ上手は1ターン長く耐える
    if (player.publicTrait === 'swimmer' && player.swamTurn === 0) {
      player.swamTurn = state.turn;
      continue;
    }
    player.secretUsed = true;
    events.push({ type: 'drowned', playerId: player.id });
    player.hp = 0;
    eliminate(state, player, events);
  }
}

/** 動物を狩る */
export function huntNpc(state: GameState, player: PlayerState, npc: Npc, weaponHit: number, weaponDamage: number, rng: Rng, events: GameEvent[]) {
  const bonus = player.nestBonus ? NEST_HIT_BONUS : 0;
  player.nestBonus = false;
  const hit = rng.next() < weaponHit + bonus;
  let killed = false;
  let gained: ReturnType<typeof receive>['gained'] = [];
  let lost: ReturnType<typeof receive>['lost'] = [];
  if (hit) {
    npc.hp -= weaponDamage;
    if (npc.hp <= 0) {
      killed = true;
      state.npcs = state.npcs.filter((n) => n !== npc);
      if (npc.kind === 'critter') state.critterRespawns.push(state.turn + CRITTER_RESPAWN_TURNS);
      const blade = hasItem(player, 'stone_knife') || hasItem(player, 'survival_knife');
      const meat = NPC_MEAT[npc.kind] + (blade && NPC_MEAT[npc.kind] > 0 ? 1 : 0);
      const stacks = meat > 0 ? [{ item: 'meat' as const, count: meat }] : [];
      if (npc.carried) stacks.push(npc.carried as never);
      ({ gained, lost } = receive(player, stacks));
      if (npc.kind === 'boar' && hasRole(player, 'soldier')) player.progress.warPoints += BOAR.warPoints;
    } else if (npc.kind === 'boar' && npc.hp <= BOAR.fleeHp && !npc.fledUntil) {
      npc.fledUntil = state.turn + BOAR.recoverTurns;
    }
  }
  events.push({ type: 'hunted', playerId: player.id, kind: npc.kind, killed, hit, gained, lost });
}

/** 漂流者を手当てする。医師は道具なしで、他の人は包帯を使う */
export function aidNpc(player: PlayerState, npc: Npc, rng: Rng, events: GameEvent[]): boolean {
  const doctor = hasRole(player, 'doctor');
  if (!doctor) {
    const bandage = player.inventory.find((s) => s.item === 'bandage');
    if (!bandage) return false;
    bandage.count -= 1;
    if (bandage.count === 0) player.inventory.splice(player.inventory.indexOf(bandage), 1);
  } else {
    // 4.5 漂流者の治療も回数に数える
    player.progress.healCount += 1;
  }
  npc.followerOf = player.id;
  npc.followTurns = FOLLOW_TURNS;
  const { gained, lost } = receive(player, [{ ...rng.pick(CASTAWAY_REWARDS) }]);
  events.push({ type: 'aided', playerId: player.id, gained, lost });
  return true;
}

/** 8.5 幽霊の怪異。1日に1回（最終局面は毎ターン） */
export function haunt(state: GameState, player: PlayerState, kind: HauntKind, x: number, y: number, events: GameEvent[]) {
  const stamp = state.finalPhase ? state.turn : dayOf(state.turn);
  if (player.alive || player.hauntedOn === stamp) return;
  const { width, height } = state.map;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  player.hauntedOn = stamp;
  const around: number[] = [];
  for (let cy = Math.max(0, y - 1); cy <= Math.min(height - 1, y + 1); cy++) {
    for (let cx = Math.max(0, x - 1); cx <= Math.min(width - 1, x + 1); cx++) around.push(cy * width + cx);
  }
  if (kind === 'fog') state.fog.push({ cells: around, untilTurn: state.turn + 1 });
  if (kind === 'bless') state.blessed.push({ cells: [y * width + x], untilTurn: state.turn + 1 });
  if (kind === 'noise') state.footprints.push({ cell: y * width + x, untilTurn: state.turn + FOOTPRINT_TURNS });
  if (kind === 'lure' && state.npcs.length > 0) {
    const animal = [...state.npcs]
      .filter((n) => n.kind !== 'castaway')
      .sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y))[0];
    if (animal) stepNpc(state, animal, towards(animal, x, y));
  }
  events.push({ type: 'haunted', playerId: player.id, kind });
}
