// ルーム管理。通信の方法には依存しない（Connection を渡すだけで動く）ので、ソケットなしでテストできる。
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createGame,
  DEFAULT_PLAN_SECONDS,
  cleanText,
  createDraft,
  describeProgress,
  draftAuto,
  draftPickItems,
  draftPickJob,
  draftPickStart,
  draftReroll,
  finishDraft,
  getDraftView,
  getPlayerView,
  ghostPlanForCpu,
  hashSeed,
  JOB_IDS,
  planForCpu,
  proposeAlliance,
  proposeTrade,
  respondAlliance,
  respondTrade,
  senseBetrayal,
  Rng,
  useMindRead,
  type CpuLevel,
  type DraftState,
  type JobId,
  ITEMS,
  LETTER,
  MAP_CONFIG,
  MAP_SIZE_NAMES,
  MAX_PLAN_ACTIONS,
  PLAN_SECONDS_OPTIONS,
  projectPlan,
  RECIPES,
  replayFor,
  resolveTurn,
  respondWhisper,
  sendWhisper,
  type GameEvent,
  type GameState,
  type MapSize,
  type PlanAction,
} from '../core/index';
import type { ClientMessage, ErrorCode, PlanStatus, RoomSetup, ServerMessage } from '../net/protocol';

export interface Connection {
  send(message: ServerMessage): void;
}

export interface RoomOptions {
  stepMs?: number;
  /** false ならキャラ選択を飛ばす（テスト用） */
  useDraft?: boolean;
  /** キャラ選択の1段階あたりの制限時間 */
  draftSeconds?: number;
  /** 天候やイベントを動かす。指定がなければ useDraft と同じ */
  world?: boolean;
  /** 誰もいなくなったルームを消すまでの時間 */
  emptyRoomMs?: number;
  maxRooms?: number;
  inviteOrigin?: string;
}

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const NAME_MAX = 12;
const SEED_MAX = 32;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

interface Member {
  id: number;
  token: string;
  name: string;
  connection: Connection | null;
  plan: PlanAction[];
  ready: boolean;
  /** CPUの席 */
  cpu?: CpuLevel;
}

const CPU_LEVELS: readonly string[] = ['easy', 'normal', 'hard'];
/** 10.3 切断した人の代打ちは「ふつう」 */
const SUBSTITUTE_LEVEL: CpuLevel = 'normal';
const CPU_WHISPER_REPLY = '休戦しないか？ 今は争いたくない。';

type Stage = 'lobby' | 'draft' | 'planning' | 'resolving' | 'finished';
const DEFAULT_DRAFT_SECONDS = 40;

function cleanName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim().slice(0, NAME_MAX) : '';
  return name || fallback;
}

function cleanSetup(value: unknown): RoomSetup {
  const raw = (value ?? {}) as Partial<RoomSetup>;
  const players = MAP_CONFIG[Number(raw.players)] ? Number(raw.players) : 3;
  const mapSize: MapSize = typeof raw.mapSize === 'string' && raw.mapSize in MAP_SIZE_NAMES ? raw.mapSize : 'small';
  const planSeconds = PLAN_SECONDS_OPTIONS.includes(Number(raw.planSeconds))
    ? Number(raw.planSeconds)
    : DEFAULT_PLAN_SECONDS;
  const seed = typeof raw.seed === 'string' ? raw.seed.trim().slice(0, SEED_MAX) : '';
  const cpuLevel = typeof raw.cpuLevel === 'string' && CPU_LEVELS.includes(raw.cpuLevel) ? raw.cpuLevel : null;
  return { players, mapSize, planSeconds, cpuLevel, ...(seed ? { seed } : {}) };
}

/** 送られてきた予約の形を確かめる（中身の妥当性は projectPlan で見る） */
function cleanPlan(value: unknown): PlanAction[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAN_ACTIONS) return null;
  const plan: PlanAction[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    if (
      raw?.type === 'gather' ||
      raw?.type === 'rest' ||
      raw?.type === 'guard' ||
      raw?.type === 'hide' ||
      raw?.type === 'ambush' ||
      raw?.type === 'explore' ||
      raw?.type === 'repair' ||
      raw?.type === 'smash' ||
      raw?.type === 'extinguish' ||
      raw?.type === 'raftWork' ||
      raw?.type === 'launch' ||
      raw?.type === 'useRadio' ||
      raw?.type === 'falseAlarm'
    ) {
      plan.push({ type: raw.type });
    } else if (raw?.type === 'curse') {
      plan.push({ type: 'curse' });
    } else if (raw?.type === 'withhold' && Number.isInteger(raw.tradeId)) {
      plan.push({ type: 'withhold', tradeId: raw.tradeId as number });
    } else if ((raw?.type === 'hunt' || raw?.type === 'aid') && Number.isInteger(raw.npcId)) {
      plan.push({ type: raw.type, npcId: raw.npcId as number });
    } else if (
      raw?.type === 'haunt' &&
      ['fog', 'noise', 'lure', 'bless'].includes(raw.kind as string) &&
      Number.isInteger(raw.x) &&
      Number.isInteger(raw.y)
    ) {
      plan.push({ type: 'haunt', kind: raw.kind as 'fog', x: raw.x as number, y: raw.y as number });
    } else if (raw?.type === 'heal' && Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
      const who = raw.who === undefined ? {} : Number.isInteger(raw.who) ? { who: raw.who as number } : null;
      if (!who) return null;
      plan.push({ type: 'heal', x: raw.x as number, y: raw.y as number, ...who });
    } else if (raw?.type === 'scout' && Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
      plan.push({ type: 'scout', x: raw.x as number, y: raw.y as number });
    } else if (raw?.type === 'use' && typeof raw.item === 'string' && Object.hasOwn(ITEMS, raw.item)) {
      plan.push({ type: 'use', item: raw.item as 'fruit' });
    } else if (raw?.type === 'craft' && typeof raw.recipe === 'string' && Object.hasOwn(RECIPES, raw.recipe)) {
      plan.push({ type: 'craft', recipe: raw.recipe as 'torch' });
    } else if (raw?.type === 'letter') {
      plan.push({ type: 'letter', text: cleanText(raw.text, LETTER.maxLength) });
    } else if (raw?.type === 'whisper' && Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
      const who = raw.who === undefined ? {} : Number.isInteger(raw.who) ? { who: raw.who as number } : null;
      if (!who) return null;
      plan.push({ type: 'whisper', x: raw.x as number, y: raw.y as number, ...who });
    } else if (raw?.type === 'move' && DIRECTIONS.includes(raw.direction as string)) {
      plan.push({ type: 'move', direction: raw.direction as 'up' });
    } else if (raw?.type === 'discard' && typeof raw.item === 'string' && Object.hasOwn(ITEMS, raw.item)) {
      plan.push({ type: 'discard', item: raw.item as 'wood' });
    } else if (raw?.type === 'attack' && Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
      const who = raw.who === undefined ? {} : Number.isInteger(raw.who) ? { who: raw.who as number } : null;
      if (!who) return null;
      const thrown = raw.throwStone === true ? { throwStone: true } : {};
      const bottle = raw.useBottle === true ? { useBottle: true } : {};
      plan.push({ type: 'attack', x: raw.x as number, y: raw.y as number, ...who, ...thrown, ...bottle });
    } else return null;
  }
  return plan;
}

class Room {
  stage: Stage = 'lobby';
  hostId = 0;
  members: Member[] = [];
  state: GameState | null = null;
  draft: DraftState | null = null;
  seed = '';
  private nextMemberId = 0;
  private get useSubstitute() {
    return !!this.state?.world;
  }
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private paused = false;

  constructor(
    readonly code: string,
    readonly setup: RoomSetup,
    private readonly stepMs: number,
    private readonly inviteOrigin: string,
    private readonly useDraft: boolean = true,
    private readonly draftSeconds: number = DEFAULT_DRAFT_SECONDS,
    private readonly world: boolean = true,
  ) {}

  addMember(name: string, connection: Connection): Member {
    const id = this.nextMemberId++;
    const member: Member = {
      id,
      token: randomUUID(),
      name: cleanName(name, `P${this.members.length + 1}`),
      connection,
      plan: [],
      ready: false,
    };
    this.members.push(member);
    if (this.members.length === 1) this.hostId = id;
    return member;
  }

  get isFull() {
    return this.members.length >= this.setup.players;
  }

  get anyoneConnected() {
    return this.members.some((m) => m.connection);
  }

  /** プレイヤー番号はゲーム開始時の並び順 */
  private seatOf(member: Member) {
    return this.members.indexOf(member);
  }

  private alive(member: Member) {
    return !!this.state && this.state.players[this.seatOf(member)]?.alive;
  }

  private status(): PlanStatus[] {
    return this.members.map((m) => ({
      id: this.seatOf(m),
      ready: m.ready || !!m.cpu || (!this.alive(m) && !this.state?.world),
      connected: !!m.connection || !!m.cpu,
    }));
  }

  private broadcastStatus() {
    const status = this.status();
    for (const m of this.members) m.connection?.send({ t: 'status', status });
  }

  sendLobby() {
    for (const m of this.members) m.connection?.send(this.lobbyMessage(m));
  }

  private lobbyMessage(member: Member): ServerMessage {
    const { seed, ...open } = this.setup;
    return {
      t: 'lobby',
      code: this.code,
      hostId: this.members.findIndex((m) => m.id === this.hostId),
      youId: this.members.indexOf(member),
      // 決まったシード値が分かると島を再現できるので、指定した本人にしか見せない
      setup: member.id === this.hostId && seed ? this.setup : open,
      members: this.members.map((m, id) => ({ id, name: m.name, connected: !!m.connection })),
      inviteUrl: `${this.inviteOrigin}/?room=${this.code}`,
    };
  }

  start(member: Member): ErrorCode | null {
    if (member.id !== this.hostId) return 'notHost';
    if (this.stage !== 'lobby') return 'alreadyStarted';
    this.seed = this.setup.seed ?? randomBytes(4).toString('hex');
    // 10.3 空いた席をCPUで埋める。前のゲームのCPUは入れ替える
    this.members = this.members.filter((m) => !m.cpu);
    if (this.setup.cpuLevel) {
      for (let i = this.members.length; i < this.setup.players; i++) {
        this.members.push({
          id: this.nextMemberId++,
          token: randomUUID(),
          name: `CPU${i - this.members.filter((m) => !m.cpu).length + 1}`,
          connection: null,
          plan: [],
          ready: true,
          cpu: this.setup.cpuLevel,
        });
      }
    }
    if (!this.useDraft) {
      this.state = createGame(this.seed, this.setup.players, {
        mapSize: this.setup.mapSize,
        seats: this.members.length,
        names: this.members.map((m) => m.name),
        world: this.world,
      });
      this.beginPlanning();
      return null;
    }
    this.draft = createDraft(this.seed, this.setup.players, this.members.length, this.setup.mapSize);
    this.stage = 'draft';
    this.updateDraft(this.draft);
    return null;
  }

  /** CPUの番なら、人間を待たずに選ぶ */
  private cpuDraftMoves(state: DraftState): DraftState {
    let next = state;
    const isCpu = (seat: number) => !!this.members[seat]?.cpu;
    for (let guard = 0; guard < 40 && next.phase !== 'done'; guard++) {
      const before = next;
      if (next.phase === 'reroll') {
        next.seats.forEach((_, seat) => {
          if (isCpu(seat) && !next.seats[seat].rerollDone) next = draftReroll(next, seat, false) ?? next;
        });
      } else if (next.phase === 'job' && isCpu(next.order[next.cursor])) {
        const open = JOB_IDS.filter((id) => !next.seats.some((s) => s.job === id));
        const seat = next.order[next.cursor];
        const job = new Rng(hashSeed(`${this.seed}:${seat}`)).pick(open);
        next = draftPickJob(next, seat, job) ?? next;
      } else if (next.phase === 'items') {
        next.seats.forEach((seat, index) => {
          if (!isCpu(index) || seat.items) return;
          const allowance = getDraftView(next, index).allowance;
          next = draftPickItems(next, index, Array.from({ length: allowance }, (_, i) => i)) ?? next;
        });
      } else if (next.phase === 'start' && isCpu(next.order[next.cursor])) {
        const open = next.starts.map((_, i) => i).filter((i) => !next.seats.some((s) => s.start === i));
        next = draftPickStart(next, next.order[next.cursor], open[0]) ?? next;
      }
      if (next === before) break;
    }
    return next;
  }

  private armDraftTimer() {
    this.clearTimer();
    this.deadline = Date.now() + this.draftSeconds * 1000;
    this.timer = setTimeout(() => {
      // 時間切れの人の分を自動で決める
      this.updateDraft(draftAuto(this.draft!));
    }, this.draftSeconds * 1000);
  }

  private updateDraft(incoming: DraftState) {
    const next = this.cpuDraftMoves(incoming);
    this.draft = next;
    if (next.phase === 'done') {
      this.clearTimer();
      this.state = createGame(this.seed, this.setup.players, {
        mapSize: this.setup.mapSize,
        setups: finishDraft(next),
        names: this.members.map((m) => m.name),
        world: this.world,
      });
      this.draft = null;
      this.beginPlanning();
      return;
    }
    this.armDraftTimer();
    for (const m of this.members) this.sendCurrent(m);
  }

  draftAction(member: Member, message: ClientMessage): ErrorCode | null {
    if (this.stage !== 'draft' || !this.draft) return null;
    const seat = this.seatOf(member);
    let next: DraftState | null = null;
    if (message.t === 'draftReroll') next = draftReroll(this.draft, seat, message.reroll === true);
    else if (message.t === 'draftJob') next = draftPickJob(this.draft, seat, message.job as JobId);
    else if (message.t === 'draftItems') next = draftPickItems(this.draft, seat, message.indexes);
    else if (message.t === 'draftStart') next = draftPickStart(this.draft, seat, message.start);
    if (!next) return 'badMessage';
    this.updateDraft(next);
    return null;
  }

  mindRead(member: Member, targetId: unknown) {
    if (this.stage !== 'planning' || typeof targetId !== 'number') return;
    const result = useMindRead(this.state!, this.seatOf(member), targetId);
    if (!result) return;
    this.state = result.state;
    member.connection?.send({ t: 'mindReadResult', targetId, actions: this.members[targetId]?.plan ?? [] });
    for (const m of this.members) m.connection?.send({ t: 'announce', events: result.events });
  }

  private beginPlanning() {
    this.stage = 'planning';
    this.paused = false;
    for (const m of this.members) {
      m.plan = [];
      m.ready = false;
    }
    this.cpuPlans();
    this.armDeadline();
    for (const m of this.members) if (m.connection) this.sendCurrent(m);
  }

  /** CPUの予約を作る。人間と同じ見え方だけで判断する */
  private cpuPlans() {
    this.members.forEach((m, seat) => {
      if (!m.cpu) return;
      m.plan = this.planFor(seat, m.cpu);
      m.ready = true;
      // 密談に誘われたら定型の返事をする
      for (const whisper of this.state!.whispers) {
        if (whisper.to !== seat || whisper.status !== 'pending') continue;
        const accepted = respondWhisper(this.state!, seat, whisper.id, true);
        if (!accepted) continue;
        this.state = sendWhisper(accepted, seat, whisper.id, CPU_WHISPER_REPLY) ?? accepted;
      }
    });
  }

  private planFor(seat: number, level: CpuLevel): PlanAction[] {
    const view = getPlayerView(this.state!, seat);
    const rng = new Rng((this.state!.rngState + seat * 7919) | 0);
    const plan = view.me.alive ? planForCpu(view, level, rng) : ghostPlanForCpu(view, rng);
    return projectPlan(view, plan).ok ? plan : [];
  }

  private armDeadline() {
    this.clearTimer();
    const planMs = this.setup.planSeconds * 1000;
    this.deadline = Date.now() + planMs;
    this.timer = setTimeout(() => this.onDeadline(), planMs);
  }

  private onDeadline() {
    this.timer = null;
    // 誰もいないあいだはターンを進めない
    if (!this.anyoneConnected) {
      this.paused = true;
      return;
    }
    this.resolve();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** そのメンバーの今の段階に合った画面を送る（再接続でも使う） */
  sendCurrent(member: Member) {
    const connection = member.connection;
    if (!connection) return;
    if (this.stage === 'lobby') {
      connection.send(this.lobbyMessage(member));
    } else if (this.stage === 'draft') {
      connection.send({
        t: 'draft',
        view: getDraftView(this.draft!, this.seatOf(member)),
        names: this.members.map((m) => m.name),
        remainingMs: Math.max(0, this.deadline - Date.now()),
      });
    } else if (this.stage === 'planning') {
      connection.send({
        t: 'planning',
        view: getPlayerView(this.state!, this.seatOf(member)),
        remainingMs: Math.max(0, this.deadline - Date.now()),
        plan: member.plan,
        ready: member.ready,
        status: this.status(),
      });
    } else if (this.stage === 'resolving') {
      connection.send({ t: 'waiting', view: getPlayerView(this.state!, this.seatOf(member)), status: this.status() });
    } else {
      connection.send(this.resultMessage(member));
    }
  }

  private resultMessage(member: Member): ServerMessage {
    const winnerId = this.state!.winnerId;
    return {
      t: 'result',
      winnerId,
      winnerName: winnerId === null ? null : this.state!.players[winnerId].name,
      reason: this.state!.victoryReason,
      seed: this.seed,
      hostId: this.members.findIndex((m) => m.id === this.hostId),
      youAreHost: member.id === this.hostId,
      players: this.state!.players.map((p) => ({
        cpu: !!this.members[p.id]?.cpu,
        id: p.id,
        name: p.name,
        job: p.job,
        extraJob: p.extraJob,
        publicTrait: p.publicTrait,
        secretTrait: p.secretTrait,
        goals: describeProgress(this.state!, p),
      })),
    };
  }

  setPlan(member: Member, actions: unknown, ready: unknown): ErrorCode | null {
    if (this.stage !== 'planning') return null;
    const plan = cleanPlan(actions);
    if (!plan) return 'badPlan';
    const seat = this.seatOf(member);
    if (!this.state!.players[seat].alive && !this.state!.world) return 'badPlan';
    if (!projectPlan(getPlayerView(this.state!, seat), plan).ok) return 'badPlan';
    member.plan = plan;
    member.ready = ready === true;
    this.noticeBetrayal(seat, plan);
    this.broadcastStatus();
    this.resolveIfEveryoneReady();
    return null;
  }

  /** 裏切りの勘：密談した相手が攻撃を予約したら、本人にだけ知らせる */
  private noticeBetrayal(seat: number, plan: PlanAction[]) {
    const { state, notices } = senseBetrayal(this.state!, seat, plan);
    this.state = state;
    for (const notice of notices) this.members[notice.to]?.connection?.send({ t: 'announce', events: [notice.event] });
  }

  /** 6.2 取引と同盟。どちらも開いている密談の中でだけ */
  deal(member: Member, message: Extract<ClientMessage, { t: 'tradePropose' | 'tradeRespond' | 'alliancePropose' | 'allianceRespond' }>) {
    if (this.stage !== 'planning') return;
    const seat = this.seatOf(member);
    let next: GameState | null = null;
    let events: GameEvent[] = [];
    if (message.t === 'tradePropose' && Number.isInteger(message.id) && message.give && message.take) {
      next = proposeTrade(this.state!, seat, message.id, { item: message.give.item, count: Number(message.give.count) }, { item: message.take.item, count: Number(message.take.count) });
    } else if (message.t === 'tradeRespond' && Number.isInteger(message.tradeId)) {
      next = respondTrade(this.state!, seat, message.tradeId, message.accept === true);
    } else if (message.t === 'alliancePropose' && Number.isInteger(message.id)) {
      next = proposeAlliance(this.state!, seat, message.id);
    } else if (message.t === 'allianceRespond' && Number.isInteger(message.id)) {
      const result = respondAlliance(this.state!, seat, message.id, message.accept === true);
      next = result?.state ?? null;
      events = result?.events ?? [];
    }
    if (!next) return;
    this.state = next;
    this.cpuDeals();
    if (events.length > 0) {
      // 同盟が成立すると見え方が変わるので、全員に計画画面を送り直す
      for (const m of this.members) {
        m.connection?.send({ t: 'announce', events });
        if (m.connection) this.sendCurrent(m);
      }
      return;
    }
    this.members.forEach((m, index) => {
      const view = getPlayerView(this.state!, index);
      m.connection?.send({ t: 'whisperUpdate', whispers: view.whispers, whisperSeen: view.whisperSeen });
    });
  }

  /** CPUは持っている物なら取引に応じる。同盟は半分の確率で受ける */
  private cpuDeals() {
    let state = this.state!;
    const formed: GameEvent[] = [];
    for (const trade of state.trades) {
      const cpu = this.members[trade.to]?.cpu;
      if (!cpu || trade.status !== 'proposed') continue;
      const owns = state.players[trade.to].inventory.some((s) => s.item === trade.take.item && s.count >= trade.take.count);
      state = respondTrade(state, trade.to, trade.id, owns) ?? state;
    }
    for (const whisper of state.whispers) {
      if (whisper.allianceFrom === undefined) continue;
      const other = whisper.allianceFrom === whisper.from ? whisper.to : whisper.from;
      if (!this.members[other]?.cpu) continue;
      const accept = hashSeed(`${this.seed}:ally:${whisper.id}:${state.turn}`) % 2 === 0;
      const result = respondAlliance(state, other, whisper.id, accept);
      if (result) {
        state = result.state;
        formed.push(...result.events);
      }
    }
    this.state = state;
    if (formed.length > 0) for (const m of this.members) m.connection?.send({ t: 'announce', events: formed });
  }

  /** 6.1 密談への返事とメッセージ。計画フェーズの間だけ受け付ける */
  whisper(member: Member, id: unknown, change: { accept: boolean } | { text: unknown }) {
    if (this.stage !== 'planning' || typeof id !== 'number') return;
    const seat = this.seatOf(member);
    const next =
      'accept' in change
        ? respondWhisper(this.state!, seat, id, change.accept)
        : sendWhisper(this.state!, seat, id, change.text);
    if (!next) return;
    this.state = next;
    this.members.forEach((m, index) => {
      const view = getPlayerView(next, index);
      m.connection?.send({ t: 'whisperUpdate', whispers: view.whispers, whisperSeen: view.whisperSeen });
    });
  }

  private resolveIfEveryoneReady() {
    if (this.stage !== 'planning') return;
    // 幽霊も怪異を選ぶので、接続している人間は全員待つ
    const waitingOn = this.members.filter((m) => m.connection && (this.alive(m) || this.state!.world));
    if (waitingOn.length > 0 && waitingOn.every((m) => m.ready)) this.resolve();
  }

  private resolve() {
    this.clearTimer();
    this.stage = 'resolving';
    const previous = this.state!;
    const plans: Record<number, PlanAction[]> = {};
    this.members.forEach((m, seat) => {
      // 10.3 切断している人はCPUが代わりに動く
      if (!m.cpu && !m.connection && m.plan.length === 0 && this.useSubstitute) plans[seat] = this.planFor(seat, SUBSTITUTE_LEVEL);
      else plans[seat] = m.plan;
      if (m.cpu === 'hard') {
        for (const trade of previous.trades) {
          if (trade.status !== 'agreed' || (trade.from !== seat && trade.to !== seat)) continue;
          if (hashSeed(`${this.seed}:withhold:${trade.id}:${previous.turn}`) % 3 === 0) plans[seat] = [...plans[seat], { type: 'withhold', tradeId: trade.id }];
        }
      }
    });
    const { state, steps } = resolveTurn(previous, plans);
    this.state = state;

    const replays = this.members.map((_, seat) => replayFor(seat, previous, steps));
    const longest = Math.max(1, ...replays.map((r) => r.length));
    this.members.forEach((m, seat) => m.connection?.send({ t: 'replay', steps: replays[seat], stepMs: this.stepMs }));

    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state!.finished) {
        this.stage = 'finished';
        for (const m of this.members) this.sendCurrent(m);
      } else {
        this.beginPlanning();
      }
    }, longest * this.stepMs);
  }

  disconnect(member: Member) {
    member.connection = null;
    if (this.stage === 'lobby') this.sendLobby();
    else if (this.stage === 'planning') {
      this.broadcastStatus();
      this.resolveIfEveryoneReady();
    } else this.broadcastStatus();
  }

  reconnect(member: Member, connection: Connection) {
    member.connection = connection;
    if (this.stage === 'lobby') this.sendLobby();
    else {
      if (this.stage === 'planning' && this.paused) {
        this.paused = false;
        this.armDeadline();
      }
      this.sendCurrent(member);
      this.broadcastStatus();
    }
  }

  /** ルームから抜ける。ゲーム中は席を残し、何も予約しない人として扱う */
  leave(member: Member) {
    if (this.stage === 'lobby') {
      this.members.splice(this.members.indexOf(member), 1);
      if (member.id === this.hostId && this.members[0]) this.hostId = this.members[0].id;
      this.sendLobby();
    } else {
      this.disconnect(member);
    }
  }

  backToLobby(member: Member): ErrorCode | null {
    if (member.id !== this.hostId) return 'notHost';
    if (this.stage !== 'finished') return null;
    this.stage = 'lobby';
    this.state = null;
    this.draft = null;
    this.seed = '';
    for (const m of this.members) {
      m.plan = [];
      m.ready = false;
    }
    this.sendLobby();
    return null;
  }

  dispose() {
    this.clearTimer();
  }
}

const ERROR_TEXT: Record<ErrorCode, string> = {
  noRoom: 'そのルームは見つかりません。合言葉を確かめてください。サーバーの再起動で消えることもあるので、その場合はルームを作り直してもらってください。',
  roomFull: 'ルームが満員です。作るときの人数を増やして、ルームを作り直してもらってください。',
  alreadyStarted: 'このルームのゲームはもう始まっているので入れません。始める前に入るか、ルームを作り直してもらってください。',
  notHost: 'ルームを作った人だけが操作できます。',
  badPlan: 'その予約はできません。',
  badMessage: '送信内容が正しくありません。',
  tooManyRooms: 'ルームが多すぎます。少し待ってからお試しください。',
  tooManyRequests: '操作が多すぎます。少し待ってからお試しください。',
};

interface Session {
  room: Room;
  member: Member;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, Session>();
  private readonly sessions = new Map<Connection, Session>();
  private readonly expiry = new Map<Room, ReturnType<typeof setTimeout>>();
  private readonly stepMs: number;
  private readonly useDraft: boolean;
  private readonly draftSeconds: number;
  private readonly world: boolean;
  private readonly emptyRoomMs: number;
  private readonly maxRooms: number;
  private readonly inviteOrigin: string;

  constructor(options: RoomOptions = {}) {
    this.stepMs = options.stepMs ?? 500;
    this.useDraft = options.useDraft ?? true;
    this.draftSeconds = options.draftSeconds ?? DEFAULT_DRAFT_SECONDS;
    this.world = options.world ?? this.useDraft;
    this.emptyRoomMs = options.emptyRoomMs ?? 30 * 60 * 1000;
    this.maxRooms = options.maxRooms ?? 200;
    this.inviteOrigin = options.inviteOrigin ?? '';
  }

  get roomCount() {
    return this.rooms.size;
  }

  handle(connection: Connection, message: ClientMessage) {
    if (message?.t === 'keepAlive') return;
    const fail = (code: ErrorCode) => connection.send({ t: 'error', code, message: ERROR_TEXT[code] });
    const session = this.sessions.get(connection);

    switch (message?.t) {
      case 'create': {
        if (session) return;
        if (this.rooms.size >= this.maxRooms) return fail('tooManyRooms');
        const room = new Room(
          this.newCode(),
          cleanSetup(message.setup),
          this.stepMs,
          this.inviteOrigin,
          this.useDraft,
          this.draftSeconds,
          this.world,
        );
        this.rooms.set(room.code, room);
        this.enter(room, room.addMember(message.name, connection), connection);
        room.sendLobby();
        return;
      }
      case 'join': {
        if (session) return;
        const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
        const room = this.rooms.get(code);
        if (!room) return fail('noRoom');
        if (room.stage !== 'lobby') return fail('alreadyStarted');
        if (room.isFull) return fail('roomFull');
        this.enter(room, room.addMember(message.name, connection), connection);
        room.sendLobby();
        return;
      }
      case 'resume': {
        const found = this.tokens.get(message.token);
        if (!found) return fail('noRoom');
        // 同じ人の古い接続が残っていたら置き換える
        if (found.member.connection) this.sessions.delete(found.member.connection);
        this.enter(found.room, found.member, connection);
        found.room.reconnect(found.member, connection);
        return;
      }
    }

    if (!session) return fail('noRoom');
    const { room, member } = session;
    let error: ErrorCode | null = null;
    switch (message?.t) {
      case 'start':
        error = room.start(member);
        break;
      case 'plan':
        error = room.setPlan(member, message.actions, message.ready);
        break;
      case 'draftReroll':
      case 'draftJob':
      case 'draftItems':
      case 'draftStart':
        error = room.draftAction(member, message);
        break;
      case 'mindRead':
        room.mindRead(member, message.targetId);
        break;
      case 'whisperRespond':
        room.whisper(member, message.id, { accept: message.accept === true });
        break;
      case 'whisperSend':
        room.whisper(member, message.id, { text: message.text });
        break;
      case 'tradePropose':
      case 'tradeRespond':
      case 'alliancePropose':
      case 'allianceRespond':
        room.deal(member, message);
        break;
      case 'backToLobby':
        error = room.backToLobby(member);
        break;
      case 'leave':
        this.sessions.delete(connection);
        this.tokens.delete(member.token);
        room.leave(member);
        connection.send({ t: 'left' });
        this.expireIfEmpty(room);
        break;
      default:
        error = 'badMessage';
    }
    if (error) fail(error);
  }

  /** 接続が切れたとき。ルームには残り、token で復帰できる */
  disconnected(connection: Connection) {
    const session = this.sessions.get(connection);
    if (!session) return;
    this.sessions.delete(connection);
    session.room.disconnect(session.member);
    this.expireIfEmpty(session.room);
  }

  dispose() {
    for (const room of this.rooms.values()) room.dispose();
    for (const timer of this.expiry.values()) clearTimeout(timer);
  }

  private enter(room: Room, member: Member, connection: Connection) {
    member.connection = connection;
    const session = { room, member };
    this.sessions.set(connection, session);
    this.tokens.set(member.token, session);
    const timer = this.expiry.get(room);
    if (timer) clearTimeout(timer);
    this.expiry.delete(room);
    connection.send({ t: 'joined', code: room.code, token: member.token, memberId: room.members.indexOf(member) });
  }

  private expireIfEmpty(room: Room) {
    if (room.anyoneConnected || this.expiry.has(room)) return;
    this.expiry.set(
      room,
      setTimeout(() => {
        this.expiry.delete(room);
        if (room.anyoneConnected) return;
        room.dispose();
        this.rooms.delete(room.code);
        for (const [token, session] of this.tokens) if (session.room === room) this.tokens.delete(token);
      }, this.emptyRoomMs),
    );
  }

  private newCode(): string {
    for (;;) {
      const bytes = randomBytes(4);
      const code = Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
      if (!this.rooms.has(code)) return code;
    }
  }
}
