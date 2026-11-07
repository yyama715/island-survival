// 調整する数値はここに集める。章番号は docs/island-survival-spec.md のもの。
import type { ItemId, ItemStack, JobId, MapSize, RecipeId, SpecialTerrainId, StructureKind, TerrainId } from './types';

export interface MapConfig {
  size: number;
  land: number;
  specials: number;
  springs: { min: number; max: number };
}

export const MAP_SIZE_NAMES: Record<MapSize, string> = { small: '小', medium: '中', large: '大' };

// 3.1 サイズ。size は陸地が出られる範囲で、その外側に海を SEA_MARGIN 周ぶん足す
// 中・大は1辺を2マスずつ広げ、陸地の割合（約66%）をそろえる
export const MAP_CONFIG: Record<number, Record<MapSize, MapConfig>> = {
  3: {
    small: { size: 10, land: 65, specials: 4, springs: { min: 2, max: 3 } },
    medium: { size: 12, land: 95, specials: 5, springs: { min: 3, max: 4 } },
    large: { size: 14, land: 130, specials: 6, springs: { min: 4, max: 5 } },
  },
  4: {
    small: { size: 11, land: 80, specials: 4, springs: { min: 2, max: 3 } },
    medium: { size: 13, land: 112, specials: 5, springs: { min: 3, max: 4 } },
    large: { size: 15, land: 148, specials: 6, springs: { min: 4, max: 5 } },
  },
  5: {
    small: { size: 12, land: 95, specials: 5, springs: { min: 2, max: 3 } },
    medium: { size: 14, land: 130, specials: 6, springs: { min: 3, max: 4 } },
    large: { size: 16, land: 170, specials: 7, springs: { min: 4, max: 5 } },
  },
};
export const SEA_MARGIN = 1;

// 3.4 生成の比率と公平性チェック
export const MAP_RATIOS = { beach: 0.24, mountain: 0.09, rock: 0.13, forestOfRest: 0.5 };
export const MAX_WATER_DISTANCE = 5;
export const MIN_SPECIAL_DISTANCE_FROM_START = 3;
export const MAX_MAP_ATTEMPTS = 200;

// 5章 ステータス
export const INITIAL_HP = 10;
export const AP_PER_TURN = 3;
export const INVENTORY_SLOTS = 8;
export const STACK_SIZE = 5;
export const INITIAL_HUNGER = 8;
export const INITIAL_WATER = 8;
export const MAX_HUNGER = 10;
export const MAX_WATER = 10;
/** 満腹度と水分がどちらもこの値以下だと「弱っている」 */
export const WEAK_THRESHOLD = 3;
export const STATUS_DAMAGE = { starving: 1, thirsty: 2, poison: 1, bleed: 1 };
/**
 * 出血が次のターンも続く確率。1ターン目のダメージは必ず受ける。
 * 表の長さ＋1ターンが最長で、この値なら最大4ターン（数値は初期案）
 */
export const BLEED_CONTINUE_CHANCE: readonly number[] = [0.6, 0.3, 0.15];
/**
 * 疲労が起きる確率（初期案）。疲れると次のターンのAPが1減る。休息すると防げる。
 * 移動は使ったAPの分だけ確率が上がる。ここにない行動では疲れない
 */
export const FATIGUE = { movePerAp: 0.05, gather: 0.05, craft: 0.1, build: 0.25, attack: 0.15 };
/** キノコの外れ（初期案） */
export const POISON = { chance: 0.25, turns: 2 };

// 6章 行動
export const GATHER_AP = 1;
export const GUARD_AP = 1;
export const HIDE_AP = 1;
export const AMBUSH_AP = 1;
export const LETTER_AP = 1;
export const WHISPER_AP = 1;
export const REST_HUT_MULTIPLIER = 2;
export const HEAL_AP = 1;
export const EXPLORE_AP = 1;
export const REPAIR_AP = 1;

export const SWIM_COST = 2;
export const HUNT_AP = 1;
export const AID_AP = 1;
export const NEST_HIT_BONUS = 0.2;
export const CURSE_HIT = -0.1;

// 9章 天候とイベント（数値は初期案）
export const WEATHER = {
  weights: { sunny: 50, rain: 35, storm: 15 },
  sunnyWater: 1,
  rainWater: 2,
  stormDamage: 2,
  stormMoveCost: 1,
  /** 1日あたり何かのイベントが起きる確率 */
  eventChance: 0.4,
  tideStartDay: 7,
};
export const SUPPLY_ITEMS: ItemStack[] = [
  { item: 'medicine', count: 1 },
  { item: 'rope', count: 2 },
  { item: 'cloth', count: 3 },
  { item: 'bandage', count: 2 },
  { item: 'water', count: 3 },
];
export const CASTAWAY_REWARDS: ItemStack[] = [
  { item: 'bandage', count: 2 },
  { item: 'rope', count: 2 },
  { item: 'cloth', count: 2 },
  { item: 'medicine', count: 1 },
];

// 9.1 動物
export const NPC_HP = { critter: 1, monkey: 2, boar: 8, herd: 3, castaway: 3 };
export const NPC_MAX = { critter: 4, monkey: 2, boar: 1, herd: 1, castaway: 1 };
export const NPC_MEAT = { critter: 1, monkey: 0, boar: 3, herd: 2, castaway: 0 };
export const NPC_NAMES = { critter: '小動物', monkey: '猿', boar: '大イノシシ', herd: '動物の群れ', castaway: '漂流者' };
export const BOAR = { hit: 0.6, damage: 2, friendHit: -0.3, territory: 2, fleeHp: 3, recoverTurns: 4, warPoints: 3 };
export const HERD_DAMAGE = 1;
export const FOOTPRINT_TURNS = 2;
export const CRITTER_RESPAWN_TURNS = 6;
export const FOLLOW_TURNS = 3;
export const FOLLOWER_GATHER = 10;

// 9.2 最終局面
export const FINAL = {
  /** 11日目の朝 */
  startTurn: 21,
  stormDamage: 1,
  buildingDamage: 3,
  attackBonus: 1,
  gatherPenalty: 0.5,
  hutHp: 6,
};

// 4章 職業と特性の数値（初期案を含む）
export const SOLDIER = { hit: 0.1, damage: 1 };
export const FISHER_FISH_MULTIPLIER = 2;
export const BIG_EATER_HP = 2;
export const EARLY_RISER_BONUS = 3;
export const LOST_SENSE_DRIFT = 0.1;
export const LOST_SENSE_GATHER = 10;
export const TENACITY_HP = 3;
export const MAP_FRAGMENT_RADIUS = 2;

// 6.1 密談と手紙
export const WHISPER = { maxMessagesEach: 3, maxLength: 50 };
export const LETTER = { maxLength: 50, material: 'wood' as ItemId };

// 7.3 罠。設置マスに入った他人にHP−2＋足止め（そのターンのAPがなくなる）
export const TRAP_DAMAGE = 2;

export interface RecipeDef {
  name: string;
  ap: number;
  /** どれか1組があれば作れる */
  inputs: { item: ItemId; count: number }[][];
  output?: ItemStack;
  builds?: StructureKind;
  summary: string;
  /** この職業だけが作れる */
  job?: JobId;
  /** 建てられる地形 */
  onTerrain?: TerrainId;
  /** 料理人のフルコース。素材は6ジャンルの食材 */
  course?: boolean;
}

const need = (...pairs: [ItemId, number][]) => pairs.map(([item, count]) => ({ item, count }));

// 7.3 クラフトレシピ。いかだは素材を少しずつ運ぶので raftWork で作る
export const RECIPES: Record<RecipeId, RecipeDef> = {
  medicine: { name: '薬', ap: 1, inputs: [need(['medicinal_herb', 1], ['water', 1])], output: { item: 'medicine', count: 1 }, job: 'doctor', summary: '使った人のHP+3。誰が使っても医師の治療回数に数える' },
  fort: { name: '砦', ap: 3, inputs: [need(['wood', 8], ['stone', 4], ['rope', 2])], builds: 'fort', job: 'carpenter', summary: '耐久10。中にいると防御+2。修理できる' },
  full_course: { name: '島のフルコース', ap: 2, inputs: [[]], output: { item: 'full_course', count: 1 }, job: 'cook', course: true, summary: '6ジャンルの食材を各1つ。食べると特殊勝利' },
  smoke: { name: '狼煙', ap: 3, inputs: [need(['wood', 5], ['flint', 1]), need(['wood', 5], ['matches', 1])], builds: 'smoke', onTerrain: 'mountain', summary: '山で上げる（3〜9日目）。3ターン後に救助船が砂浜へ来る' },
  backpack: { name: 'リュック', ap: 2, inputs: [need(['cloth', 3], ['rope', 1])], output: { item: 'backpack', count: 1 }, summary: '所持枠+4' },
  stone_knife: { name: '石のナイフ', ap: 1, inputs: [need(['stone', 1], ['wood', 1])], output: { item: 'stone_knife', count: 1 }, summary: '攻撃 1d3+1' },
  stone_axe: { name: '石斧', ap: 2, inputs: [need(['stone', 2], ['wood', 1])], output: { item: 'stone_axe', count: 1 }, summary: '攻撃 1d3+2、木材の採取が倍' },
  spear: { name: '槍', ap: 2, inputs: [need(['wood', 2], ['stone', 1])], output: { item: 'spear', count: 1 }, summary: '隣接8マスから攻撃 1d3+2' },
  bow: { name: '弓', ap: 2, inputs: [need(['wood', 2], ['rope', 1], ['ore', 1])], output: { item: 'bow', count: 1 }, summary: '2マス先まで攻撃（夜は使えない）' },
  torch: { name: '松明', ap: 1, inputs: [need(['wood', 1], ['grass', 1])], output: { item: 'torch', count: 1 }, summary: '夜の視界+1。ただし夜でも誰なのか見える' },
  canteen: { name: '水筒', ap: 1, inputs: [need(['shell_husk', 2])], output: { item: 'canteen', count: 1 }, summary: '水を持ち運べる' },
  bandage: { name: '包帯', ap: 1, inputs: [need(['grass', 2])], output: { item: 'bandage', count: 1 }, summary: '使うとHP+2、出血が止まる。出血中に作ると自動で使う' },
  rope: { name: 'ロープ', ap: 1, inputs: [need(['grass', 3]), need(['rope_scrap', 2])], output: { item: 'rope', count: 1 }, summary: '弓などの素材' },
  sail: { name: '帆', ap: 2, inputs: [need(['cloth', 2], ['wood', 1])], output: { item: 'sail', count: 1 }, summary: 'いかだの素材' },
  fishing_rod: { name: '釣竿', ap: 1, inputs: [need(['wood', 1], ['rope', 1])], output: { item: 'fishing_rod', count: 1 }, summary: '砂浜と川で魚が取れる。釣り糸より多い' },
  trap: { name: '罠', ap: 2, inputs: [need(['wood', 2], ['grass', 1])], builds: 'trap', summary: 'このマスに入った他人にHP−2＋足止め' },
  hut: { name: '小屋', ap: 3, inputs: [need(['wood', 4], ['grass', 2]), need(['wood', 2], ['grass', 2], ['nails', 1])], builds: 'hut', summary: '休息の回復が倍。釘があれば木材が少なく済む' },
};

// 8章 戦闘。攻撃はAP1で1ターンに1回まで。残りAPで届くなら相手を追いかける
export const ATTACK_AP = 1;
/** 8.4 序盤保護。最初の2日間（4ターン）はプレイヤーを攻撃できない */
export const EARLY_PROTECTION_TURNS = 4;
export const COMBAT = {
  nightMeleeHit: 0.1,
  rockDefense: 1,
  counterChance: 0.3,
  counterDamage: 1,
  diagonalHit: -0.15,
  diagonalDamage: -1,
  /** 8.1 先手の利。これ以上のダメージを受けると、まだ手番が来ていない人のAPが減る */
  firstStrikeDamage: 2,
  /** 8.3 相手が警戒中 */
  guardHit: -0.2,
  /** 6章 防御・警戒で受けるダメージが減る量 */
  guardDamage: 2,
  /** 8.2 森のマスにいる相手へ遠距離攻撃 */
  rangedIntoForest: -0.2,
};

export interface WeaponDef {
  /** 0 は同じマス、1 は隣接8マスまで */
  range: number;
  hit: number;
  /** 1d3 を振るか（振らないときは bonus がそのままダメージ） */
  rollsD3: boolean;
  bonus: number;
  /** 遠距離攻撃は夜に使えない */
  ranged?: boolean;
  /** 上下左右と斜めの直線上だけ届く */
  straightOnly?: boolean;
  /** 命中してダメージを与えたときに出血させる確率 */
  bleed: number;
}

// 8.2 射程と命中率。出血は刃物が100%、それ以外は初期案
export const UNARMED: WeaponDef = { range: 0, hit: 0.7, rollsD3: false, bonus: 1, bleed: 0 };
export const WEAPONS: Partial<Record<ItemId, WeaponDef>> = {
  stone_knife: { range: 0, hit: 0.7, rollsD3: true, bonus: 1, bleed: 1 },
  stone_axe: { range: 0, hit: 0.7, rollsD3: true, bonus: 2, bleed: 1 },
  survival_knife: { range: 0, hit: 0.7, rollsD3: true, bonus: 1, bleed: 1 },
  spear: { range: 1, hit: 0.6, rollsD3: true, bonus: 2, bleed: 0.5 },
  bow: { range: 2, hit: 0.6, rollsD3: false, bonus: 2, ranged: true, bleed: 0.5 },
};
/** 投石。石を1個使う。武器ではないので略奪の対象になる */
export const THROW: WeaponDef = { range: 2, hit: 0.5, rollsD3: false, bonus: 1, ranged: true, straightOnly: true, bleed: 0 };
export const THROW_ITEM: ItemId = 'stone';
/** 瓶で殴る。当たっても外れても割れてなくなる使い切りの武器。自分で選んだときだけ使う */
export const BOTTLE: WeaponDef = { range: 0, hit: 0.7, rollsD3: false, bonus: 2, bleed: 0.5 };
export const BOTTLE_ITEM: ItemId = 'bottle';

// 8.1 行動順。機敏さは職業の基礎値（マイルストーン4）。それまでは全員同じ値
export const DEFAULT_AGILITY = 2;
export const INITIATIVE_MODIFIER = { badlyHurt: -1, overloaded: -1, weak: -2, rested: 1 };

// 2.4 計画フェーズの制限時間。ルーム作成時に選ぶ
export const PLAN_SECONDS_OPTIONS: readonly number[] = [60, 120];
export const DEFAULT_PLAN_SECONDS = 60;
export const MAX_PLAN_ACTIONS = 24;

// 7.2 運の調整。枯渇度1につき成功率を割合で下げ、夜も同様に下げる（数値は初期案）
export const DEPLETION = {
  max: 3,
  penaltyPerLevel: 0.2,
  /** このターン数ごとに全マスの枯渇度が1回復する */
  recoverEveryTurns: 2,
};
export const NIGHT_GATHER_PENALTY = 0.2;
export const PITY_AFTER_DRY_STREAK = 2;

export interface ItemRoll {
  item: ItemId;
  min: number;
  max: number;
}

export type GatherEntry =
  | { kind: 'nothing'; weight: number }
  | { kind: 'item'; weight: number; rolls: ItemRoll[]; requiresAnyOf?: ItemId[] }
  | { kind: 'danger'; weight: number; damage: number }
  | { kind: 'nest'; weight: number };

const one = (item: ItemId): ItemRoll => ({ item, min: 1, max: 1 });
const FISHING_TOOLS: ItemId[] = ['fishing_line', 'fishing_rod'];

// 3.2 地形タイル、3.3 視界、7.1 採取テーブル
export interface TerrainDef {
  name: string;
  /** 移動コスト。null は進入不可 */
  moveCost: number | null;
  visionDay: number;
  visionNight: number;
  /** 3.3 この地形の奥は見えない（手前のマス自体は見える） */
  blocksSight?: boolean;
  /** 3.3 視線を遮る地形の向こうまで見渡せる */
  seesOverBlocks?: boolean;
  /** 6章 隠れることができる */
  canHide?: boolean;
  summary: string;
  gather: GatherEntry[];
}

const noGather: GatherEntry[] = [];

export const TERRAIN: Record<TerrainId, TerrainDef> = {
  sea: { name: '海', moveCost: null, visionDay: 0, visionNight: 0, summary: '進めない', gather: noGather },
  beach: {
    name: '砂浜',
    moveCost: 1,
    visionDay: 1,
    visionNight: 1,
    summary: '貝、漂着物、魚（釣り道具が必要）',
    gather: [
      { kind: 'nothing', weight: 25 },
      { kind: 'item', weight: 30, rolls: [one('shell')] },
      { kind: 'item', weight: 25, rolls: [one('cloth'), one('rope_scrap'), one('bottle')] },
      { kind: 'item', weight: 15, rolls: [one('fish')], requiresAnyOf: FISHING_TOOLS },
      { kind: 'item', weight: 5, rolls: [one('wreck_part')] },
    ],
  },
  grass: {
    name: '草原',
    moveCost: 1,
    visionDay: 0,
    visionNight: 0,
    summary: '草、香草、木の実、薬草',
    gather: [
      { kind: 'nothing', weight: 20 },
      { kind: 'item', weight: 40, rolls: [one('grass')] },
      { kind: 'item', weight: 15, rolls: [one('herb')] },
      { kind: 'item', weight: 15, rolls: [one('nut')] },
      { kind: 'item', weight: 5, rolls: [one('medicinal_herb')] },
      { kind: 'nest', weight: 5 },
    ],
  },
  forest: {
    name: '森',
    moveCost: 2,
    visionDay: -1,
    visionNight: -1,
    blocksSight: true,
    canHide: true,
    summary: '木材、果実、キノコ。視界が狭く、外からも奥は見えない',
    gather: [
      { kind: 'nothing', weight: 20 },
      { kind: 'item', weight: 35, rolls: [{ item: 'wood', min: 1, max: 2 }] },
      { kind: 'item', weight: 20, rolls: [one('fruit')] },
      { kind: 'item', weight: 15, rolls: [one('mushroom')] },
      { kind: 'item', weight: 8, rolls: [one('honey'), one('medicinal_herb')] },
      { kind: 'danger', weight: 2, damage: 2 },
    ],
  },
  rock: {
    name: '岩場',
    moveCost: 2,
    visionDay: 0,
    visionNight: 0,
    canHide: true,
    summary: '石、火打石、鳥の卵',
    gather: [
      { kind: 'nothing', weight: 30 },
      { kind: 'item', weight: 45, rolls: [one('stone')] },
      { kind: 'item', weight: 15, rolls: [one('flint')] },
      { kind: 'item', weight: 10, rolls: [one('egg')] },
    ],
  },
  mountain: {
    name: '山',
    moveCost: 3,
    visionDay: 2,
    visionNight: 1,
    seesOverBlocks: true,
    summary: '鉱石、石、薬草。視界が非常に広い',
    gather: [
      { kind: 'nothing', weight: 35 },
      { kind: 'item', weight: 30, rolls: [one('ore')] },
      { kind: 'item', weight: 20, rolls: [one('stone')] },
      { kind: 'item', weight: 10, rolls: [one('medicinal_herb')] },
      { kind: 'item', weight: 5, rolls: [one('big_feather')] },
    ],
  },
  spring: { name: '泉', moveCost: 1, visionDay: 0, visionNight: 0, summary: '淡水が確実に手に入る', gather: noGather },
  river: { name: '川', moveCost: 1, visionDay: 0, visionNight: 0, summary: '淡水。釣り道具があれば魚も', gather: noGather },
  cave: { name: '洞窟', moveCost: 2, visionDay: 0, visionNight: 0, summary: '最初の採取はレア確定', gather: noGather },
  wreck: { name: '難破船', moveCost: 1, visionDay: 0, visionNight: 0, summary: '最初の採取はレア確定', gather: noGather },
  ruins: { name: '遺跡', moveCost: 2, visionDay: 0, visionNight: 0, summary: '最初の採取はレア確定', gather: noGather },
};

export const VISION_BASE = 1;
export const TORCH_NIGHT_VISION = 1;
/** 水筒がないときに泉や川でその場で飲んで回復する量（初期案） */
export const DRINK_AT_SOURCE = 3;

export const WATER_TERRAINS: readonly TerrainId[] = ['spring', 'river'];
export const SPECIAL_TERRAINS: readonly SpecialTerrainId[] = ['cave', 'wreck', 'ruins'];
/** 特殊マスを置きたい地形（テーマに合わせる。なければ他の陸地へ） */
export const SPECIAL_PLACEMENT: Record<SpecialTerrainId, readonly TerrainId[]> = {
  cave: ['rock'],
  wreck: ['beach'],
  ruins: ['forest', 'grass'],
};

export const RIVER_FISH_CHANCE = 0.2;
export const CANTEEN: ItemId = 'canteen';
export { FISHING_TOOLS };

// 7.1 特殊マス。初回はレア確定、2回目以降は「何もなし」70%
export const SPECIAL_REPEAT_NOTHING_CHANCE = 0.7;
export const SPECIAL_LOOT: Record<SpecialTerrainId, ItemRoll[]> = {
  cave: [{ item: 'ore', min: 2, max: 2 }, { item: 'flint', min: 2, max: 2 }, one('big_feather')],
  wreck: [{ item: 'cloth', min: 2, max: 2 }, { item: 'rope', min: 2, max: 2 }, one('wreck_part')],
  ruins: [one('honey'), { item: 'medicinal_herb', min: 2, max: 2 }, one('big_feather')],
};

export interface ItemUse {
  /** 食べ物（料理人や鍋で回復量が増える） */
  food?: boolean;
  /** 魚と肉（塩で回復量が増える） */
  salted?: boolean;
  /** 中毒も治す */
  curesPoison?: boolean;
  /** 食べると特殊勝利 */
  winsGame?: boolean;
  hunger?: number;
  water?: number;
  hp?: number;
  /** キノコの外れ */
  risky?: boolean;
  /** 出血を止める */
  stopsBleeding?: boolean;
  /** 使ったあとに残る物 */
  leaves?: ItemId;
}

// 回復量は 7.1 にあるもの以外は初期案
export const ITEMS: Record<ItemId, { name: string; use?: ItemUse }> = {
  wood: { name: '木材' },
  fruit: { name: '果実', use: { hunger: 2, food: true } },
  mushroom: { name: 'キノコ', use: { hunger: 3, risky: true, food: true } },
  honey: { name: '蜂蜜', use: { hunger: 2, food: true } },
  medicinal_herb: { name: '薬草' },
  shell: { name: '貝', use: { hunger: 2, leaves: 'shell_husk', food: true } },
  island_lord: { name: '島の主' },
  meat: { name: '肉', use: { hunger: 3, food: true, salted: true } },
  dried_fish: { name: '干し魚', use: { hunger: 3, food: true, salted: true } },
  nails: { name: '釘' },
  antiseptic: { name: '消毒液', use: { hp: 1, stopsBleeding: true, curesPoison: true } },
  medicine: { name: '薬', use: { hp: 3 } },
  compass: { name: 'コンパス' },
  map_fragment: { name: '地図の断片' },
  binoculars: { name: '双眼鏡' },
  pot: { name: '鍋' },
  salt: { name: '塩' },
  matches: { name: 'マッチ' },
  survival_knife: { name: 'サバイバルナイフ' },
  backpack: { name: 'リュック' },
  full_course: { name: '島のフルコース', use: { winsGame: true } },
  shell_husk: { name: '貝殻' },
  cloth: { name: '布' },
  rope_scrap: { name: 'ロープ片' },
  bottle: { name: '瓶' },
  fish: { name: '魚', use: { hunger: 3, food: true, salted: true } },
  wreck_part: { name: '難破船の部品' },
  grass: { name: '草' },
  herb: { name: '香草', use: { hunger: 1, food: true } },
  nut: { name: '木の実', use: { hunger: 1, food: true } },
  stone: { name: '石' },
  flint: { name: '火打石' },
  egg: { name: '鳥の卵', use: { hunger: 2, food: true, salted: true } },
  ore: { name: '鉱石' },
  big_feather: { name: '大羽根' },
  water: { name: '淡水', use: { water: 3 } },
  rope: { name: 'ロープ' },
  stone_knife: { name: '石のナイフ' },
  stone_axe: { name: '石斧' },
  spear: { name: '槍' },
  bow: { name: '弓' },
  torch: { name: '松明' },
  bandage: { name: '包帯', use: { hp: 2, stopsBleeding: true } },
  sail: { name: '帆' },
  fishing_line: { name: '釣り糸' },
  fishing_rod: { name: '釣竿' },
  canteen: { name: '水筒' },
};
