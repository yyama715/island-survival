export type TerrainId =
  | 'sea'
  | 'beach'
  | 'grass'
  | 'forest'
  | 'rock'
  | 'mountain'
  | 'spring'
  | 'river'
  | 'cave'
  | 'wreck'
  | 'ruins';

export type SpecialTerrainId = 'cave' | 'wreck' | 'ruins';

export type ItemId =
  | 'wood'
  | 'fruit'
  | 'mushroom'
  | 'honey'
  | 'medicinal_herb'
  | 'shell'
  | 'cloth'
  | 'rope_scrap'
  | 'bottle'
  | 'fish'
  | 'wreck_part'
  | 'grass'
  | 'herb'
  | 'nut'
  | 'stone'
  | 'flint'
  | 'egg'
  | 'ore'
  | 'big_feather'
  | 'water'
  | 'rope'
  | 'stone_knife'
  | 'stone_axe'
  | 'spear'
  | 'bow'
  | 'torch'
  | 'bandage'
  | 'sail'
  | 'shell_husk'
  | 'fishing_line'
  | 'fishing_rod'
  | 'canteen'
  | 'island_lord'
  | 'dried_fish'
  | 'nails'
  | 'antiseptic'
  | 'medicine'
  | 'compass'
  | 'map_fragment'
  | 'binoculars'
  | 'pot'
  | 'salt'
  | 'matches'
  | 'survival_knife'
  | 'backpack'
  | 'full_course';

export type JobId = 'fisher' | 'carpenter' | 'doctor' | 'soldier' | 'explorer' | 'cook';

export type TraitId =
  // 公開特性
  | 'swift_feet'
  | 'iron_stomach'
  | 'big_eater'
  | 'night_eyes'
  | 'lucky'
  | 'heat_proof'
  | 'swimmer'
  | 'respected'
  | 'hawk_eye'
  | 'island_memory'
  // 秘密特性
  | 'play_dead'
  | 'hidden_purse'
  | 'mind_reader'
  | 'lost_sense'
  | 'radio'
  | 'two_tongues'
  | 'trap_master'
  | 'early_riser'
  | 'pickpocket'
  | 'beast_friend'
  | 'false_alarm'
  | 'tenacity'
  | 'other_face';

export type Rarity = 'common' | 'rare' | 'super' | 'legend';

/** ゲーム開始時に決まったキャラクター */
export interface PlayerSetup {
  job: JobId;
  publicTrait: TraitId;
  secretTrait: TraitId;
  /** 「もう一つの顔」で秘密に持つ職業 */
  extraJob?: JobId;
  items: ItemStack[];
  /** 選んだ初期位置の番号（map.starts の添字） */
  start: number;
}

export type VictoryReason =
  | 'lastStanding'
  | 'fisher'
  | 'carpenter'
  | 'doctor'
  | 'soldier'
  | 'explorer'
  | 'cook'
  | 'raft'
  | 'ship';

export type RecipeId =
  | 'medicine'
  | 'fort'
  | 'full_course'
  | 'smoke'
  | 'backpack'
  | 'stone_knife'
  | 'stone_axe'
  | 'spear'
  | 'bow'
  | 'torch'
  | 'canteen'
  | 'bandage'
  | 'rope'
  | 'sail'
  | 'fishing_rod'
  | 'trap'
  | 'hut';

export type StructureKind = 'hut' | 'trap' | 'fort' | 'smoke' | 'raft';

export interface Structure {
  kind: StructureKind;
  ownerId: number;
  /** 砦といかだの耐久 */
  hp?: number;
  /** 砦が完成したターン */
  builtTurn?: number;
  /** いかだに運び込んだ素材 */
  stock?: ItemStack[];
}

/** 7.4 救助船 */
export interface Ship {
  x: number;
  y: number;
  /** 呼んだ人。到着地点をすぐ知る */
  callerId: number;
  arrivesTurn: number;
  /** このターンの終わりまで待つ */
  leavesTurn: number;
  /** もう去った。これ以降は呼べない */
  gone?: boolean;
}

/** 4.5 勝利条件の進み具合 */
export interface Progress {
  fishCaught: number;
  lordCaughtBefore: boolean;
  lordHeldTurns: number;
  healCount: number;
  healedBy: Record<number, number>;
  warPoints: number;
  explored: number[];
  specialsVisited: number[];
}

export interface Letter {
  text: string;
}

/** 6.1 密談。次の計画フェーズの間だけ使える */
export interface Whisper {
  id: number;
  from: number;
  to: number;
  status: 'pending' | 'open' | 'refused';
  messages: { from: number; text: string }[];
}

export type MapSize = 'small' | 'medium' | 'large';
export type Phase = 'day' | 'night';
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Point {
  x: number;
  y: number;
}

export interface ItemStack {
  item: ItemId;
  count: number;
}

export interface GameMap {
  width: number;
  height: number;
  terrain: TerrainId[];
  /** 生成時の高さ。最終局面で沈む順番にも使う */
  elevation: number[];
  starts: Point[];
  /** 再生成を含めて何回目の試行で完成したか */
  attempts: number;
}

export interface PlayerState {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  ap: number;
  alive: boolean;
  inventory: ItemStack[];
  /** そのプレイヤーが最後に見た地形の記憶。地震などで実際の地形とずれてもよい */
  memory: (TerrainId | null)[];
  /** 「何もなし」が続いた回数（天井の判定用） */
  dryStreak: number;
  /** 小動物の巣を見つけた（次の狩りの命中率＋20%。狩りはマイルストーン5） */
  nestBonus: boolean;
  /** 最後に攻撃したターン（1ターンに1回まで） */
  attackedOnTurn: number;
  hunger: number;
  water: number;
  /** 食中毒の残りターン */
  poisonTurns: number;
  /** 出血中。毎ターンHPが減り、包帯か時間で止まる */
  bleeding: boolean;
  /** 今の出血でダメージを受けた回数 */
  bleedTicks: number;
  /** このターンの行動で疲れた。次のターンのAPが減る */
  fatiguedNext: boolean;
  /** 疲れていて、このターンのAPが減っている */
  tired: boolean;
  /** 隠れている。動くか採取か攻撃をすると解除される */
  hidden: boolean;
  /** 防御・警戒を予約したターン（行動順に関係なく、そのターンはずっと効く） */
  guardTurn: number;
  /** 待ち伏せを予約したターン */
  ambushTurn: number;
  /** 休息したターン（次のターンの行動値に効く） */
  restedTurn: number;
  maxHp: number;
  job: JobId | null;
  publicTrait: TraitId | null;
  secretTrait: TraitId | null;
  extraJob: JobId | null;
  /** 秘密特性を公開したか */
  secretRevealed: boolean;
  /** 一度きりの特性を使ったか */
  secretUsed: boolean;
  progress: Progress;
  /** 健脚を使ったターン */
  freeMoveTurn: number;
  /** 人望を使った日 */
  freeWhisperDay: number;
  /** 鷹の目を使った日 */
  scoutDay: number;
  /** 探索したターン（視界が広がる） */
  exploreTurn: number;
  /** 死んだふり中。他の人には脱落して見える */
  playingDead: boolean;
  /** 執念で復活を待っている */
  reviving: boolean;
  /** 砦を修理したターン */
  repairedTurn: number;
  /** 無線機を直したか */
  radioFixed: boolean;
  /** 医師に初めて治療してもらったか */
  treatedOnce: boolean;
}

/** 8.1 行動値の内訳は公開情報 */
export interface InitiativeEntry {
  playerId: number;
  value: number;
  agility: number;
}

export interface GameState {
  seed: string;
  turn: number;
  rngState: number;
  /** 今のターンの行動順（先手から） */
  initiative: InitiativeEntry[];
  finished: boolean;
  /** 全員が同時に倒れた場合は null のまま終わる */
  winnerId: number | null;
  victoryReason: VictoryReason | null;
  ship: Ship | null;
  /** 鷹の目で一時的に見えるマス */
  scouts: { playerId: number; cells: number[]; untilTurn: number }[];
  /** 「勝利目前」を知らせ済みのプレイヤー */
  nearNotified: number[];
  map: GameMap;
  /** マスごとの枯渇度 */
  depletion: number[];
  /** 特殊マスの初回レアが取られたか */
  looted: boolean[];
  /** 2.3 脱落した人の遺品。キーはマスの番号 */
  relics: Record<number, ItemStack[]>;
  /** 建てた物。キーはマスの番号 */
  structures: Record<number, Structure>;
  /** 6.1 置かれた手紙。キーはマスの番号 */
  letters: Record<number, Letter[]>;
  /** 解決中に予約された密談。解決の終わりの位置で成立を判定する */
  whisperIntents: { from: number; to: number }[];
  /** 今の計画フェーズで使える密談 */
  whispers: Whisper[];
  players: PlayerState[];
}

/** 計画フェーズで予約する行動 */
export type PlanAction =
  | { type: 'move'; direction: Direction }
  | { type: 'gather' }
  | { type: 'discard'; item: ItemId }
  /**
   * 計画のときに見えていた相手を指定する。昼は who で本人を選ぶ。
   * 夜は人影しか分からないので、マスだけを指定する。
   */
  | { type: 'attack'; x: number; y: number; who?: number; throwStone?: boolean; useBottle?: boolean }
  | { type: 'use'; item: ItemId }
  | { type: 'craft'; recipe: RecipeId }
  | { type: 'rest' }
  | { type: 'guard' }
  | { type: 'hide' }
  | { type: 'ambush' }
  | { type: 'letter'; text: string }
  /** 相手の指定は攻撃と同じ */
  | { type: 'whisper'; x: number; y: number; who?: number }
  /** 医師の治療。相手の指定は攻撃と同じ */
  | { type: 'heal'; x: number; y: number; who?: number }
  | { type: 'explore' }
  /** 今いるマスの砦を直す */
  | { type: 'repair' }
  /** 今いるマスの砦やいかだを壊す */
  | { type: 'smash' }
  /** 今いるマスの狼煙を消す */
  | { type: 'extinguish' }
  /** 砂浜のいかだに素材を運び込む（なければ作り始める） */
  | { type: 'raftWork' }
  | { type: 'launch' }
  /** 救助の無線機。1回目で修理し、2回目で呼ぶ */
  | { type: 'useRadio' }
  /** 鷹の目。好きなマスとその周りを見る */
  | { type: 'scout'; x: number; y: number }
  /** 偽の知らせ */
  | { type: 'falseAlarm' };

export type Action =
  | { type: 'heal'; playerId: number; targetId: number }
  | { type: 'explore'; playerId: number }
  | { type: 'repair'; playerId: number }
  | { type: 'smash'; playerId: number }
  | { type: 'extinguish'; playerId: number }
  | { type: 'raftWork'; playerId: number }
  | { type: 'launch'; playerId: number }
  | { type: 'useRadio'; playerId: number }
  | { type: 'scout'; playerId: number; x: number; y: number }
  | { type: 'falseAlarm'; playerId: number }
  | { type: 'move'; playerId: number; direction: Direction }
  | { type: 'gather'; playerId: number }
  | { type: 'discard'; playerId: number; item: ItemId }
  | { type: 'attack'; playerId: number; targetId: number; throwStone?: boolean; useBottle?: boolean }
  | { type: 'use'; playerId: number; item: ItemId }
  | { type: 'craft'; playerId: number; recipe: RecipeId }
  | { type: 'rest'; playerId: number }
  | { type: 'guard'; playerId: number }
  | { type: 'hide'; playerId: number }
  | { type: 'ambush'; playerId: number }
  | { type: 'letter'; playerId: number; text: string }
  | { type: 'whisper'; playerId: number; targetId: number }
  | { type: 'endTurn' };

export type BlockReason =
  | 'sea'
  | 'noAp'
  | 'eliminated'
  | 'notOwned'
  | 'protected'
  | 'alreadyAttacked'
  | 'missingMaterials'
  | 'occupied'
  | 'cannotHide'
  | 'inventoryFull'
  | 'notAllowed';

export type GameEvent =
  | { type: 'blocked'; playerId: number; reason: BlockReason; at?: Point; terrain?: TerrainId; cost?: number }
  | { type: 'moved'; playerId: number; x: number; y: number; terrain: TerrainId; cost: number }
  | { type: 'gathered'; playerId: number; terrain: TerrainId; gained: ItemStack[]; lost: ItemStack[]; pity: boolean }
  | { type: 'gatherNothing'; playerId: number; terrain: TerrainId; missingTool: boolean }
  | { type: 'gatherDanger'; playerId: number; terrain: TerrainId; damage: number; eliminated: boolean }
  | { type: 'foundNest'; playerId: number }
  | { type: 'drank'; playerId: number; terrain: TerrainId }
  | { type: 'discarded'; playerId: number; item: ItemId }
  | { type: 'turnStarted'; turn: number; day: number; phase: Phase }
  /** 行動順に沿った手番の開始（公開情報。何をしたかは含まない） */
  | { type: 'actorTurn'; playerId: number }
  /** 止められた移動より後の予約は実行しない */
  | { type: 'planCancelled'; playerId: number; count: number }
  /** 他の人の移動が視界に入った。夜は誰なのか分からない */
  | { type: 'sighted'; who: number | null; x: number; y: number }
  | { type: 'playerEliminated'; playerId: number }
  | { type: 'gameFinished'; winnerId: number | null }
  /** 夜は相手が誰か分からないので、本人以外は null になる */
  | {
      type: 'attackResult';
      attackerId: number | null;
      targetId: number | null;
      x: number;
      y: number;
      hit: boolean;
      damage: number;
      counter: number;
      stolen: ItemStack | null;
      ambush: boolean;
      /** この攻撃で相手が新たに出血した */
      bleeding: boolean;
      /** 瓶が割れた */
      bottleBroke: boolean;
    }
  /** 相手に届かなかった */
  | { type: 'attackFizzled'; playerId: number }
  /** 他の人どうしの戦闘が視界の中で起きた。結果の細かいところは分からない */
  | { type: 'combatSeen'; attackerId: number | null; targetId: number | null; x: number; y: number }
  | { type: 'relicTaken'; playerId: number; items: ItemStack[] }
  | {
      type: 'used';
      playerId: number;
      item: ItemId;
      hunger: number;
      water: number;
      hp: number;
      poisoned: boolean;
      stoppedBleeding: boolean;
    }
  /** 空腹、渇き、中毒、出血のダメージ */
  | { type: 'statusDamage'; playerId: number; hunger: number; thirst: number; poison: number; bleed: number }
  /** 行動で疲れた。次のターンのAPが減る */
  | { type: 'fatigued'; playerId: number }
  /** 出血が自然に止まった */
  | { type: 'bleedStopped'; playerId: number }
  | { type: 'healed'; playerId: number; targetId: number | null; hp: number; maxHpUp: boolean }
  /** 治療してもらった（本人にだけ届く） */
  | { type: 'wasHealed'; playerId: number; hp: number; maxHpUp: boolean }
  | { type: 'explored'; playerId: number }
  | { type: 'repaired'; playerId: number; hp: number }
  | { type: 'smashed'; playerId: number; kind: StructureKind; hp: number; destroyed: boolean }
  | { type: 'raftWorked'; playerId: number; complete: boolean; stored: ItemStack[] }
  | { type: 'radioFixed'; playerId: number }
  | { type: 'scouted'; playerId: number }
  /** 呼んだ本人にだけ届く */
  | { type: 'shipCalled'; playerId: number; x: number; y: number; arrivesTurn: number }
  /** ここから下は全員に公開 */
  | { type: 'traitRevealed'; playerId: number; trait: TraitId }
  | { type: 'nearVictory' }
  | { type: 'lordCaught' }
  | { type: 'fortCompleted' }
  | { type: 'fortDestroyed' }
  | { type: 'smokeLit'; x: number; y: number }
  | { type: 'smokeOut' }
  | { type: 'shipSoon'; x: number; y: number }
  | { type: 'shipArrived'; x: number; y: number }
  | { type: 'shipLeft' }
  | { type: 'playerRevived'; playerId: number }
  | { type: 'victory'; playerId: number; reason: VictoryReason }
  | { type: 'rested'; playerId: number; healed: number }
  | { type: 'crafted'; playerId: number; recipe: RecipeId; gained: ItemStack[]; lost: ItemStack[] }
  | { type: 'guarded'; playerId: number }
  | { type: 'hid'; playerId: number }
  | { type: 'ambushSet'; playerId: number }
  /** 隠れていたのを見つかった（本人にだけ届く） */
  | { type: 'foundOut'; playerId: number }
  /** 隠れていた人を見つけた（見つけた本人にだけ届く） */
  | { type: 'spotted'; playerId: number; x: number; y: number }
  | { type: 'trapTriggered'; playerId: number; damage: number }
  | { type: 'trapDisarmed'; playerId: number }
  /** 自分の罠が作動した（持ち主にだけ届く） */
  | { type: 'trapSprung'; playerId: number; x: number; y: number }
  | { type: 'letterLeft'; playerId: number }
  | { type: 'whisperAsked'; playerId: number }
  /** 解決の終わりに相手が近くにいなかった。APは戻らない */
  | { type: 'whisperFailed'; playerId: number };

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/** 解決フェーズの1コマ。state はこのコマが終わった時点の状態 */
export interface ResolutionStep {
  actorId: number | null;
  events: GameEvent[];
  state: GameState;
}

export interface TurnResolution {
  state: GameState;
  steps: ResolutionStep[];
}
