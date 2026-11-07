// 調整する数値はここに集める。章番号は docs/island-survival-spec.md のもの。
import type { ItemId, MapSize, SpecialTerrainId, TerrainId } from './types';

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
export const INVENTORY_SLOTS = 6;
export const STACK_SIZE = 5;

// 6章 行動
export const GATHER_AP = 1;

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
};

export interface WeaponDef {
  /** 0 は同じマス、1 は隣接8マスまで */
  range: number;
  hit: number;
  /** 1d3 を振るか（振らないときは bonus がそのままダメージ） */
  rollsD3: boolean;
  bonus: number;
}

// 8.2 射程と命中率。投石と弓はクラフトと一緒に足す
export const UNARMED: WeaponDef = { range: 0, hit: 0.7, rollsD3: false, bonus: 1 };
export const WEAPONS: Partial<Record<ItemId, WeaponDef>> = {
  stone_knife: { range: 0, hit: 0.7, rollsD3: true, bonus: 1 },
  stone_axe: { range: 0, hit: 0.7, rollsD3: true, bonus: 2 },
  spear: { range: 1, hit: 0.6, rollsD3: true, bonus: 2 },
};

// 8.1 行動順。機敏さは職業の基礎値（マイルストーン4）。それまでは全員同じ値
export const DEFAULT_AGILITY = 2;
export const INITIATIVE_MODIFIER = { badlyHurt: -1, overloaded: -1 };

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

export const ITEMS: Record<ItemId, { name: string }> = {
  wood: { name: '木材' },
  fruit: { name: '果実' },
  mushroom: { name: 'キノコ' },
  honey: { name: '蜂蜜' },
  medicinal_herb: { name: '薬草' },
  shell: { name: '貝' },
  cloth: { name: '布' },
  rope_scrap: { name: 'ロープ片' },
  bottle: { name: '瓶' },
  fish: { name: '魚' },
  wreck_part: { name: '難破船の部品' },
  grass: { name: '草' },
  herb: { name: '香草' },
  nut: { name: '木の実' },
  stone: { name: '石' },
  flint: { name: '火打石' },
  egg: { name: '鳥の卵' },
  ore: { name: '鉱石' },
  big_feather: { name: '大羽根' },
  water: { name: '淡水' },
  rope: { name: 'ロープ' },
  stone_knife: { name: '石のナイフ' },
  stone_axe: { name: '石斧' },
  spear: { name: '槍' },
  fishing_line: { name: '釣り糸' },
  fishing_rod: { name: '釣竿' },
  canteen: { name: '水筒' },
};
