// 4章 職業と固有能力のデータ。ルールブックもここから作る。
import type { ItemId, ItemStack, JobId, Rarity, TraitId } from './types';

export interface JobDef {
  name: string;
  /** 8.1 機敏さの基礎値 */
  agility: number;
  passive: string;
  goal: string;
  /** 初期所持品の候補 */
  items: ItemStack[];
}

const stack = (item: ItemId, count = 1): ItemStack => ({ item, count });

export const JOBS: Record<JobId, JobDef> = {
  fisher: {
    name: '漁師',
    agility: 2,
    passive: '砂浜の採取で魚が出やすい',
    goal: '島の主を釣り上げ、持ったまま3ターン生き延びる',
    items: [stack('fishing_line'), stack('stone_knife'), stack('dried_fish')],
  },
  carpenter: {
    name: '大工',
    agility: 1,
    passive: 'クラフトと建設のAP−1（最低1）',
    goal: '砦を完成させ、4ターン壊されずに守る',
    items: [stack('nails'), stack('rope'), stack('wood', 2)],
  },
  doctor: {
    name: '医師',
    agility: 1,
    passive: '治療（AP1）で相手のHP+3と状態異常を解除。初めて治療した相手は最大HP+1。薬を作れる',
    goal: '治療を合計5回（同じ相手は2回まで）行い、7日目の朝を生きて迎える',
    items: [stack('bandage', 2), stack('antiseptic'), stack('medicine')],
  },
  soldier: {
    name: '元軍人',
    agility: 2,
    passive: '攻撃力+1、命中率+10%',
    goal: '戦果を8点集める（命中1点、プレイヤーを脱落させると3点）',
    items: [stack('survival_knife'), stack('compass')],
  },
  explorer: {
    name: '探検家',
    agility: 3,
    passive: '視界+1',
    goal: '島の陸地の40%を踏破し、特殊マスを3か所訪れる',
    items: [stack('map_fragment'), stack('binoculars'), stack('canteen')],
  },
  cook: {
    name: '料理人',
    agility: 2,
    passive: '食料の回復量+1。キノコの中毒にならない',
    goal: '6ジャンルの食材で島のフルコースを作って食べる',
    items: [stack('pot'), stack('salt'), stack('matches')],
  },
};

export const JOB_IDS = Object.keys(JOBS) as JobId[];

export const RARITY_NAMES: Record<Rarity, string> = {
  common: 'コモン',
  rare: 'レア',
  super: 'スーパーレア',
  legend: '伝説',
};
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'super', 'legend'];
/** 4.3 特性の配布率 */
export const RARITY_WEIGHTS: Record<Rarity, number> = { common: 50, rare: 30, super: 15, legend: 5 };

export interface TraitDef {
  name: string;
  secret: boolean;
  rarity: Rarity;
  text: string;
}

export const TRAITS: Record<TraitId, TraitDef> = {
  swift_feet: { name: '健脚', secret: false, rarity: 'common', text: '草原・砂浜の移動が1ターンに1回AP消費なし' },
  iron_stomach: { name: '鉄の胃袋', secret: false, rarity: 'common', text: '食中毒にならない' },
  big_eater: { name: '大食い', secret: false, rarity: 'common', text: '満腹度の減りが1多い。代わりに最大HP+2' },
  heat_proof: { name: '暑さに強い', secret: false, rarity: 'common', text: '晴れの日の追加の水分減少を受けない' },
  swimmer: { name: '泳ぎ上手', secret: false, rarity: 'common', text: '潮位上昇で沈んだマスを渡れる' },
  night_eyes: { name: '夜目', secret: false, rarity: 'rare', text: '夜でも昼と同じ視界' },
  lucky: { name: '強運', secret: false, rarity: 'rare', text: '採取で「何もなし」が出たら引き直す' },
  respected: { name: '人望', secret: false, rarity: 'rare', text: '1日に1回、APを使わずに密談できる' },
  hawk_eye: { name: '鷹の目', secret: false, rarity: 'super', text: '1日に1回、好きなマスとその周りを1ターン見られる' },
  island_memory: { name: '島の記憶', secret: false, rarity: 'legend', text: 'ゲーム開始時に水源の位置がすべて分かる' },
  play_dead: { name: '死んだふり', secret: true, rarity: 'common', text: 'HPが0になった時、一度だけHP1で耐え、他の人には脱落に見せる' },
  hidden_purse: { name: '隠し財布', secret: true, rarity: 'common', text: '略奪されても1枠だけ奪われない' },
  two_tongues: { name: '二枚舌', secret: true, rarity: 'common', text: '密談しても周りに表示されない' },
  trap_master: { name: '罠の名人', secret: true, rarity: 'common', text: '自分の罠は警戒でも見つからず、ダメージ+1' },
  early_riser: { name: '早起き', secret: true, rarity: 'common', text: '昼ターンだけ行動値+3' },
  mind_reader: { name: '読心術', secret: true, rarity: 'rare', text: '1回だけ他人の予約を覗ける' },
  lost_sense: { name: '方向音痴', secret: true, rarity: 'rare', text: '10%で移動方向がずれる。代わりに採取率+10%' },
  pickpocket: { name: '盗み上手', secret: true, rarity: 'rare', text: '略奪で一番価値のある物を奪う' },
  beast_friend: { name: '動物使い', secret: true, rarity: 'rare', text: '動物に襲われにくい' },
  false_alarm: { name: '偽の知らせ', secret: true, rarity: 'super', text: '1回だけ「誰かが勝利目前」の偽の通知を出せる' },
  tenacity: { name: '執念', secret: true, rarity: 'super', text: '脱落しても1回だけ、次の朝にランダムな砂浜でHP3で復活する' },
  radio: { name: '救助の無線機', secret: true, rarity: 'legend', text: '山で修理すると、狼煙なしで救助を呼べる' },
  other_face: { name: 'もう一つの顔', secret: true, rarity: 'legend', text: '誰も選ばなかった職業の特殊勝利条件も秘密で持つ' },
};

export const PUBLIC_TRAITS = (Object.keys(TRAITS) as TraitId[]).filter((id) => !TRAITS[id].secret);
export const SECRET_TRAITS = (Object.keys(TRAITS) as TraitId[]).filter((id) => TRAITS[id].secret);

/** 4.5 料理人の6ジャンル */
export type FoodGenre = 'fish' | 'meat' | 'fruit' | 'mushroom' | 'shell' | 'herb';
export const FOOD_GENRES: FoodGenre[] = ['fish', 'meat', 'fruit', 'mushroom', 'shell', 'herb'];
export const GENRE_NAMES: Record<FoodGenre, string> = {
  fish: '魚',
  meat: '肉',
  fruit: '果実',
  mushroom: 'キノコ',
  shell: '貝',
  herb: '香草',
};
export const ITEM_GENRE: Partial<Record<ItemId, FoodGenre>> = {
  fish: 'fish',
  dried_fish: 'fish',
  island_lord: 'fish',
  egg: 'meat',
  fruit: 'fruit',
  nut: 'fruit',
  honey: 'fruit',
  mushroom: 'mushroom',
  shell: 'shell',
  herb: 'herb',
};

// 4.5 特殊勝利の数値
export const GOALS = {
  /** 釣果が累計この数で必ず島の主が出る */
  lordCeiling: 8,
  /** 主を奪われたあとは、この数の釣果で2匹目が出る */
  secondLordCeiling: 4,
  /** 天井に届く前に主が出る確率（初期案） */
  lordChance: 0.05,
  lordHoldTurns: 3,
  fortHoldTurns: 4,
  fortHp: 10,
  fortRepair: 3,
  fortDefense: 2,
  healsNeeded: 5,
  healPerTarget: 2,
  /** 7日目の朝 */
  doctorSurviveTurn: 13,
  warPoints: 8,
  warPerHit: 1,
  warPerKill: 3,
  exploreRatio: 0.4,
  specialsNeeded: 3,
  healAmount: 3,
};

// 7.3 いかだ
export const RAFT = {
  needs: [
    { item: 'wood', count: 10 },
    { item: 'rope', count: 3 },
    { item: 'sail', count: 1 },
  ] as ItemStack[],
  ap: 2,
  hp: 6,
};

// 7.4 狼煙と救助船
export const SMOKE = {
  /** 上げられる時期。3日目の昼から9日目の昼まで */
  firstTurn: 5,
  lastTurn: 17,
  shipDelayTurns: 3,
  extinguishAp: 2,
  radioRepairAp: 2,
  radioCallAp: 1,
};

/** 持ち物に応じて枠が増える */
export const BACKPACK_SLOTS = 4;

/** 盗み上手が狙う順 */
export const STEAL_PRIORITY: ItemId[] = [
  'island_lord',
  'medicine',
  'sail',
  'rope',
  'honey',
  'fish',
  'dried_fish',
  'water',
  'bandage',
];
