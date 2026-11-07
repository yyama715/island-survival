// プレイヤーごとの見え方。画面へ送るのはこの結果だけにする（10.2 霧の不正閲覧を防ぐ）。
import {
  AID_AP,
  AMBUSH_AP,
  HEAL_RANGE,
  HUNT_AP,
  recipeInputs,
  SWIM_COST,
  WEATHER,
  ATTACK_AP,
  BOTTLE_ITEM,
  EARLY_PROTECTION_TURNS,
  EXPLORE_AP,
  GATHER_AP,
  GUARD_AP,
  HEAL_AP,
  HIDE_AP,
  ITEMS,
  REPAIR_AP,
  LETTER,
  LETTER_AP,
  MAX_PLAN_ACTIONS,
  RECIPES,
  STACK_SIZE,
  TERRAIN,
  THROW_ITEM,
  WHISPER_AP,
} from './data';
import { cellIndex, dayOf, isWeak, phaseOf, playerVision, recipeAp, seesNames, slotsOf, visibleCells } from './game';
import { RAFT, SMOKE } from './roles';
import { courseIngredients, describeProgress, type GoalLine } from './victory';
import type {
  JobId,
  NpcKind,
  TraitId,
  VictoryReason,
  Weather,
  Direction,
  GameEvent,
  GameState,
  InitiativeEntry,
  ItemId,
  ItemStack,
  Trade,
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
  /** 視界内の動物と漂流者 */
  npcs: { id: number; kind: NpcKind; following: boolean }[];
  /** 動物の足跡（幽霊の偽の足跡と見分けがつかない） */
  footprint: boolean;
}

export interface WhisperView {
  id: number;
  /** 自分が頼まれた側か */
  incoming: boolean;
  status: 'pending' | 'open' | 'refused';
  /** 相手。夜は誰なのか分からない */
  withId: number | null;
  messages: { mine: boolean; text: string }[];
  /** 6.2 この密談の取引。give は自分が渡す物、take は自分がもらう物 */
  trade: { id: number; mine: boolean; give: ItemStack; take: ItemStack; status: Trade['status'] } | null;
  /** 同盟の申し込み */
  alliance: 'none' | 'offeredByMe' | 'offeredToMe' | 'refused';
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
  /** 全プレイヤーの公開情報 */
  roster: {
    id: number;
    name: string;
    alive: boolean;
    job: JobId | null;
    publicTrait: TraitId | null;
    /** 発動して公開された秘密特性 */
    revealedTrait: TraitId | null;
    /** 自分と同盟している */
    ally: boolean;
  }[];
  /** 本人だけが知っている情報 */
  secret: { trait: TraitId | null; extraJob: JobId | null; used: boolean; radioFixed: boolean };
  /** 勝利条件の進み具合（本人にだけ） */
  goals: GoalLine[];
  /** 7.4 地図に出す公開の目印 */
  marks: { x: number; y: number; kind: 'smoke' | 'ship' | 'shipComing' | 'sink' | 'supply' | 'bounty' | 'campfire' }[];
  /** 同盟（全員に公開） */
  alliances: { a: number; b: number }[];
  weather: Weather;
  finalPhase: boolean;
  /** 8.5 幽霊としての情報 */
  ghost: { hauntReady: boolean; curseReady: boolean } | null;
  victoryReason: VictoryReason | null;
  maxHp: number;
  slots: number;
  /** 今日の人望はもう使った */
  freeWhisperSpent: boolean;
  /** 今日の鷹の目はもう使った */
  scoutSpent: boolean;
  /** このターンの健脚はもう使った */
  freeMoveSpent: boolean;
  /** 沈んだマス */
  sunk: number[];
  /** 天候やイベントが動いているゲームか */
  worldActive: boolean;
  /** 8.1 全員分の行動順と行動値は計画フェーズの前に公開する */
  initiative: InitiativeEntry[];
  finished: boolean;
  winnerId: number | null;
}

export function getPlayerView(state: GameState, playerId: number): PlayerView {
  const me = state.players[playerId];
  const { width, height } = state.map;
  const phase = phaseOf(state.turn);
  // 8.5 幽霊は霧のない全マップと生存者の位置が見える
  const isGhost = state.world && !me.alive;
  const visible = new Set(isGhost ? state.map.terrain.map((_, i) => i) : me.alive ? visibleCells(state, me) : []);
  // 4.3 鷹の目で見ているマス
  for (const scout of state.scouts) {
    if (scout.playerId === me.id && scout.untilTurn >= state.turn) for (const cell of scout.cells) visible.add(cell);
  }

  const allies = state.alliances
    .filter((a) => a.a === me.id || a.b === me.id)
    .map((a) => state.players[a.a === me.id ? a.b : a.a]);
  const cells: CellView[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const isVisible = visible.has(index);
      const remembered = me.memory[index];
      const figures: Figure[] = [];
      for (const ally of allies) {
        if (!isVisible && ally.alive && !ally.playingDead && ally.x === x && ally.y === y) figures.push({ kind: 'player', id: ally.id, name: ally.name });
      }
      if (isVisible) {
        for (const other of state.players) {
          if (!other.alive || other.x !== x || other.y !== y) continue;
          if (other.id === me.id) figures.push({ kind: 'self', id: other.id, name: other.name });
          // 隠れている人と死んだふりの人は、同じマスにいるときしか見えない
          else if (!isGhost && (other.hidden || other.playingDead) && (other.x !== me.x || other.y !== me.y)) continue;
          // 3.3 松明を持つ人や夜目の人には、夜でも誰なのか分かる
          else if (!isGhost && !seesNames(state, me, other)) figures.push({ kind: 'shadow' });
          else figures.push({ kind: 'player', id: other.id, name: other.name });
        }
      }
      const structure = state.structures[index];
      // 4.3 警戒中の人にも他人の罠は見えない。見えるのは置いた本人だけ
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
        npcs: isVisible
          ? state.npcs
              .filter((n) => n.x === x && n.y === y)
              .map((n) => ({ id: n.id, kind: n.kind, following: n.followerOf != null }))
          : [],
        footprint: (isVisible || !!remembered) && state.footprints.some((f) => f.cell === index && f.untilTurn >= state.turn),
      });
    }
  }

  const terrainHere = state.map.terrain[cellIndex(state, me.x, me.y)];
  const tradeView = (id: number | undefined): WhisperView['trade'] => {
    const trade = state.trades.find((t) => t.id === id);
    if (!trade) return null;
    const mine = trade.from === me.id;
    return { id: trade.id, mine, give: mine ? trade.give : trade.take, take: mine ? trade.take : trade.give, status: trade.status };
  };
  const whispers: WhisperView[] = state.whispers
    .filter((w) => w.from === me.id || w.to === me.id)
    .map((w) => ({
      id: w.id,
      incoming: w.to === me.id,
      status: w.status,
      withId: seesNames(state, me, state.players[w.from === me.id ? w.to : w.from]) ? (w.from === me.id ? w.to : w.from) : null,
      messages: w.messages.map((m) => ({ mine: m.from === me.id, text: m.text })),
      trade: tradeView(w.tradeId),
      alliance: w.allianceRefused ? 'refused' : w.allianceFrom === undefined ? 'none' : w.allianceFrom === me.id ? 'offeredByMe' : 'offeredToMe',
    }));
  const whisperSeen = state.whispers.flatMap((w) => {
    if (w.status !== 'open' || w.from === me.id || w.to === me.id) return [];
    const a = state.players[w.from];
    const b = state.players[w.to];
    // 4.3 二枚舌は密談しても周りに表示されない
    if (a.secretTrait === 'two_tongues' || b.secretTrait === 'two_tongues') return [];
    const seesBoth =
      visible.has(cellIndex(state, a.x, a.y)) && visible.has(cellIndex(state, b.x, b.y)) && !a.hidden && !b.hidden;
    return seesBoth ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : [];
  });

  // 7.4 狼煙は全員に見える。船は呼んだ本人と、到着の1ターン前からの全員に見える
  const marks: PlayerView['marks'] = [];
  for (const [index, structure] of Object.entries(state.structures)) {
    // 狼煙と焚き火の煙は全員に見える
    if (structure.kind === 'smoke' || structure.kind === 'campfire') {
      marks.push({ x: Number(index) % width, y: Math.floor(Number(index) / width), kind: structure.kind });
    }
  }
  const ship = state.ship;
  if (ship && !ship.gone && (ship.callerId === me.id || state.turn >= ship.arrivesTurn - SMOKE.publicLeadTurns)) {
    marks.push({ x: ship.x, y: ship.y, kind: state.turn >= ship.arrivesTurn ? 'ship' : 'shipComing' });
  }
  for (const cell of state.sinkNext) {
    marks.push({ x: cell % width, y: Math.floor(cell / width), kind: 'sink' });
  }
  if (state.supply) marks.push({ ...state.supply, kind: 'supply' });
  for (const bounty of state.bounties) {
    if (bounty.untilTurn >= state.turn) marks.push({ x: bounty.x, y: bounty.y, kind: 'bounty' });
  }
  const hauntStamp = state.finalPhase ? state.turn : dayOf(state.turn);

  return {
    width,
    height,
    turn: state.turn,
    day: dayOf(state.turn),
    phase,
    cells,
    secret: { trait: me.secretTrait, extraJob: me.extraJob, used: me.secretUsed, radioFixed: me.radioFixed },
    goals: describeProgress(state, me),
    marks,
    alliances: state.alliances,
    weather: state.weather,
    finalPhase: state.finalPhase,
    ghost: isGhost
      ? { hauntReady: me.hauntedOn !== hauntStamp, curseReady: !me.curseUsed && me.killerId !== null }
      : null,
    victoryReason: state.victoryReason,
    maxHp: me.maxHp,
    slots: slotsOf(me),
    freeWhisperSpent: me.freeWhisperDay === dayOf(state.turn),
    scoutSpent: me.scoutDay === dayOf(state.turn),
    freeMoveSpent: me.freeMoveTurn === state.turn,
    sunk: state.sunk,
    worldActive: state.world,
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
      visionRadius: playerVision(state, me),
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
    roster: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      // 死んだふりの人は、本人以外には脱落に見える
      alive: p.alive && (!p.playingDead || p.id === me.id),
      job: p.job,
      publicTrait: p.publicTrait,
      revealedTrait: p.secretRevealed ? p.secretTrait : null,
      ally: allies.some((a) => a.id === p.id),
    })),
    initiative: state.initiative
      .filter((entry) => entry.playerId === me.id || !state.players[entry.playerId].playingDead)
      .map((entry) => ({ ...entry })),
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
  // 8.5 幽霊は怪異と祟りだけができる
  if (!view.me.alive) {
    const ghostOk =
      !!view.ghost &&
      plan.every((a) => a.type === 'haunt' || a.type === 'curse') &&
      plan.filter((a) => a.type === 'haunt').length <= (view.ghost.hauntReady ? 1 : 0) &&
      plan.filter((a) => a.type === 'curse').length <= (view.ghost.curseReady ? 1 : 0);
    return { ok: ghostOk, x, y, ap, uncertain: false, owned: {} };
  }
  let ok = plan.length <= MAX_PLAN_ACTIONS;
  const me = view.roster.find((p) => p.id === view.me.id);
  let attacks = 0;
  let freeWhisperUsed = view.freeWhisperSpent;
  let freeMoveUsed = false;
  let scouted = view.scoutSpent;
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
      ap -= recipeAp(recipe.ap, me?.job ?? null);
      if (recipe.job && me?.job !== recipe.job && view.secret.extraJob !== recipe.job) ok = false;
      if (recipe.onTerrain && terrainAt(x, y) && terrainAt(x, y) !== recipe.onTerrain) ok = false;
      if (recipe.builds === 'smoke' && (view.turn < SMOKE.firstTurn || view.turn > SMOKE.lastTurn)) ok = false;
      const inputs = recipe.course
        ? courseIngredients(owned)
        : recipeInputs(action.recipe, me?.publicTrait ?? null).find((set) => set.every(({ item, count }) => (owned.get(item) ?? 0) >= count));
      if (!inputs) ok = false;
      else for (const { item, count } of inputs) spend(item, count);
      if (recipe.output) add(recipe.output.item, recipe.output.count);
      if (recipe.builds && view.cells[y * view.width + x].structure) ok = false;
      if (recipe.output && slotsNeeded(owned) > view.slots) ok = false;
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
      // 4.3 人望：1日に1回はAPを使わない
      if (me?.publicTrait === 'respected' && !freeWhisperUsed) freeWhisperUsed = true;
      else ap -= WHISPER_AP;
      if (!canTarget({ ...view, turn: Math.max(view.turn, EARLY_PROTECTION_TURNS + 1) }, action)) ok = false;
    } else if (action.type === 'heal') {
      ap -= HEAL_AP;
      if (me?.job !== 'doctor' && view.secret.extraJob !== 'doctor') ok = false;
      const here = view.cells[action.y * view.width + action.x];
      if (!here || Math.max(Math.abs(here.x - x), Math.abs(here.y - y)) > HEAL_RANGE || !canTarget({ ...view, turn: Math.max(view.turn, EARLY_PROTECTION_TURNS + 1) }, action)) ok = false;
    } else if (action.type === 'explore') {
      ap -= EXPLORE_AP;
    } else if (action.type === 'repair') {
      ap -= REPAIR_AP;
      if (me?.job !== 'carpenter' && view.secret.extraJob !== 'carpenter') ok = false;
      if (view.cells[y * view.width + x].structure !== 'fort') ok = false;
    } else if (action.type === 'smash') {
      ap -= ATTACK_AP;
      const structure = view.cells[y * view.width + x].structure;
      if (structure !== 'fort' && structure !== 'raft') ok = false;
    } else if (action.type === 'extinguish') {
      ap -= SMOKE.extinguishAp;
      if (view.cells[y * view.width + x].structure !== 'smoke') ok = false;
    } else if (action.type === 'raftWork') {
      ap -= recipeAp(RAFT.ap, me?.job ?? null);
      const here = terrainAt(x, y);
      if (here && here !== 'beach') ok = false;
    } else if (action.type === 'launch') {
      ap -= 1;
      if (view.cells[y * view.width + x].structure !== 'raft') ok = false;
    } else if (action.type === 'useRadio') {
      if (view.secret.trait !== 'radio' || view.secret.used) ok = false;
      ap -= view.secret.radioFixed ? SMOKE.radioCallAp : SMOKE.radioRepairAp;
      if (!view.secret.radioFixed && terrainAt(x, y) !== 'mountain') ok = false;
    } else if (action.type === 'scout') {
      if (me?.publicTrait !== 'hawk_eye' || scouted) ok = false;
      scouted = true;
      if (!view.cells[action.y * view.width + action.x] || view.cells[action.y * view.width + action.x].x !== action.x) ok = false;
    } else if (action.type === 'falseAlarm') {
      if (view.secret.trait !== 'false_alarm' || view.secret.used) ok = false;
    } else if (action.type === 'hunt') {
      ap -= HUNT_AP;
      const seen = view.cells.some((c) => c.npcs.some((n) => n.id === action.npcId && n.kind !== 'castaway'));
      if (!seen) ok = false;
    } else if (action.type === 'aid') {
      ap -= AID_AP;
      const here = view.cells[y * view.width + x];
      if (!here.npcs.some((n) => n.id === action.npcId && n.kind === 'castaway' && !n.following)) ok = false;
      if (me?.job !== 'doctor' && view.secret.extraJob !== 'doctor') spend('bandage', 1);
    } else if (action.type === 'haunt' || action.type === 'curse') {
      ok = false;
    } else if (action.type === 'withhold') {
      // 合意した取引で、自分の分を渡さない
      if (!view.whispers.some((w) => w.trade?.id === action.tradeId && w.trade.status === 'agreed')) ok = false;
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
      let cost = known === null ? 1 : TERRAIN[known].moveCost;
      // 泳ぎ上手は沈んだマスを渡れる
      if (cost === null && me?.publicTrait === 'swimmer' && view.sunk.includes(ny * view.width + nx)) cost = SWIM_COST;
      if (cost === null) {
        ok = false;
        continue;
      }
      // 嵐の日は移動コスト+1
      if (view.weather === 'storm' && view.worldActive) cost += WEATHER.stormMoveCost;
      // 4.3 健脚：草原と砂浜の移動が1ターンに1回無料
      if (me?.publicTrait === 'swift_feet' && !freeMoveUsed && !view.freeMoveSpent && (known === 'grass' || known === 'beach')) {
        freeMoveUsed = true;
        cost = 0;
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
        // 全員に公開される出来事
        case 'weatherChanged':
        case 'supplyDropped':
        case 'quake':
        case 'herdAppeared':
        case 'boarAppeared':
        case 'castawayAppeared':
        case 'tideNotice':
        case 'tideRose':
        case 'finalStarted':
        case 'finalSunk':
        case 'traitRevealed':
        case 'nearVictory':
        case 'bountyPosted':
        case 'allianceFormed':
        case 'allianceBroken':
        case 'lordCaught':
        case 'fortCompleted':
        case 'fortDestroyed':
        case 'smokeLit':
        case 'smokeOut':
        case 'shipSoon':
        case 'shipArrived':
        case 'shipLeft':
        case 'playerRevived':
        case 'victory':
          events.push(event);
          changed = true;
          break;
        // 手番と関係なく本人にだけ届くもの
        case 'weatherHit':
        case 'npcHit':
        case 'monkeyStole':
        case 'drowned':
        case 'wasHealed':
        case 'shipCalled':
        case 'statusDamage':
        case 'bleedStopped':
        case 'foundOut':
        case 'spotted':
        case 'trapSprung':
        case 'whisperFailed':
        case 'traded':
        case 'betrayalSensed':
        case 'driftFound':
        case 'escaped':
        case 'survivorHeld':
        case 'bountyClaimed':
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
