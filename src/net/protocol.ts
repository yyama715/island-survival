// サーバーと画面のあいだで送るメッセージ。
import type {
  CpuLevel,
  DraftView,
  GameEvent,
  GoalLine,
  ItemStack,
  JobId,
  MapSize,
  PlanAction,
  PlayerView,
  ReplayStep,
  TraitId,
  VictoryReason,
  WhisperView,
} from '../core/index';

export interface RoomSetup {
  players: number;
  mapSize: MapSize;
  /** 計画フェーズの制限時間 */
  planSeconds: number;
  /** 空いた席をCPUで埋めるときの強さ。null なら埋めない */
  cpuLevel?: CpuLevel | null;
  /** 空ならサーバーが決めて、リザルトまで伏せる */
  seed?: string;
}

export type ClientMessage =
  | { t: 'create'; name: string; setup: RoomSetup }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; token: string }
  | { t: 'start' }
  | { t: 'plan'; actions: PlanAction[]; ready: boolean }
  | { t: 'draftReroll'; reroll: boolean }
  | { t: 'draftJob'; job: JobId }
  | { t: 'draftItems'; indexes: number[] }
  | { t: 'draftStart'; start: number }
  | { t: 'mindRead'; targetId: number }
  | { t: 'whisperRespond'; id: number; accept: boolean }
  | { t: 'whisperSend'; id: number; text: string }
  /** 6.2 密談の中で取引を持ちかける。give は自分が渡す物 */
  | { t: 'tradePropose'; id: number; give: ItemStack; take: ItemStack }
  | { t: 'tradeRespond'; tradeId: number; accept: boolean }
  /** 密談の中で同盟を申し込む／応じる */
  | { t: 'alliancePropose'; id: number }
  | { t: 'allianceRespond'; id: number; accept: boolean }
  | { t: 'backToLobby' }
  | { t: 'leave' }
  /** 接続中はホスティング先にサーバーを眠らせないための合図。返事はない */
  | { t: 'keepAlive' };

export interface MemberInfo {
  id: number;
  name: string;
  connected: boolean;
}

export interface PlanStatus {
  id: number;
  ready: boolean;
  connected: boolean;
}

export type ErrorCode =
  | 'noRoom'
  | 'roomFull'
  | 'alreadyStarted'
  | 'notHost'
  | 'badPlan'
  | 'badMessage'
  | 'tooManyRooms'
  | 'tooManyRequests';

export type ServerMessage =
  /** ルームに入れた。token を保存しておくと再接続で復帰できる */
  | { t: 'joined'; code: string; token: string; memberId: number }
  | {
      t: 'lobby';
      code: string;
      hostId: number;
      youId: number;
      setup: RoomSetup;
      members: MemberInfo[];
      inviteUrl: string;
    }
  /** 計画フェーズの開始（再接続時も同じものを送る） */
  | {
      t: 'planning';
      view: PlayerView;
      remainingMs: number;
      plan: PlanAction[];
      ready: boolean;
      status: PlanStatus[];
    }
  | { t: 'status'; status: PlanStatus[] }
  /** 4.1 キャラ選択 */
  | { t: 'draft'; view: DraftView; names: string[]; remainingMs: number }
  /** 4.3 読心術で覗いた予約（使った本人にだけ届く） */
  | { t: 'mindReadResult'; targetId: number; actions: PlanAction[] }
  /** 計画フェーズ中に全員へ知らせる出来事 */
  | { t: 'announce'; events: GameEvent[] }
  /** 計画フェーズ中の密談の変化 */
  | { t: 'whisperUpdate'; whispers: WhisperView[]; whisperSeen: { x: number; y: number }[] }
  /** 解決フェーズの再生。全員の再生が終わる頃に次のメッセージが届く */
  | { t: 'replay'; steps: ReplayStep[]; stepMs: number }
  /** 解決の再生中に再接続した人へ、盤面だけ渡す */
  | { t: 'waiting'; view: PlayerView; status: PlanStatus[] }
  | {
      t: 'result';
      winnerId: number | null;
      winnerName: string | null;
      reason: VictoryReason | null;
      seed: string;
      hostId: number;
      youAreHost: boolean;
      /** 10.1 リザルトでは全員の秘密特性と進み具合を公開する */
      players: {
        id: number;
        name: string;
        job: JobId | null;
        extraJob: JobId | null;
        publicTrait: TraitId | null;
        secretTrait: TraitId | null;
        goals: GoalLine[];
        cpu: boolean;
      }[];
    }
  | { t: 'left' }
  | { t: 'error'; code: ErrorCode; message: string };
