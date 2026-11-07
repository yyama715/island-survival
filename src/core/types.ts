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
  | 'fishing_line'
  | 'fishing_rod'
  | 'canteen';

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
  map: GameMap;
  /** マスごとの枯渇度 */
  depletion: number[];
  /** 特殊マスの初回レアが取られたか */
  looted: boolean[];
  /** 2.3 脱落した人の遺品。キーはマスの番号 */
  relics: Record<number, ItemStack[]>;
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
  | { type: 'attack'; x: number; y: number; who?: number };

export type Action =
  | { type: 'move'; playerId: number; direction: Direction }
  | { type: 'gather'; playerId: number }
  | { type: 'discard'; playerId: number; item: ItemId }
  | { type: 'attack'; playerId: number; targetId: number }
  | { type: 'endTurn' };

export type BlockReason = 'sea' | 'noAp' | 'eliminated' | 'notOwned' | 'protected' | 'alreadyAttacked';

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
    }
  /** 相手に届かなかった */
  | { type: 'attackFizzled'; playerId: number }
  /** 他の人どうしの戦闘が視界の中で起きた。結果の細かいところは分からない */
  | { type: 'combatSeen'; attackerId: number | null; targetId: number | null; x: number; y: number }
  | { type: 'relicTaken'; playerId: number; items: ItemStack[] };

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
