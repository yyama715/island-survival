// ルーム管理。通信の方法には依存しない（Connection を渡すだけで動く）ので、ソケットなしでテストできる。
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createGame,
  DEFAULT_PLAN_SECONDS,
  getPlayerView,
  ITEMS,
  MAP_CONFIG,
  MAP_SIZE_NAMES,
  MAX_PLAN_ACTIONS,
  PLAN_SECONDS_OPTIONS,
  projectPlan,
  replayFor,
  resolveTurn,
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
}

type Stage = 'lobby' | 'planning' | 'resolving' | 'finished';

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
  return { players, mapSize, planSeconds, ...(seed ? { seed } : {}) };
}

/** 送られてきた予約の形を確かめる（中身の妥当性は projectPlan で見る） */
function cleanPlan(value: unknown): PlanAction[] | null {
  if (!Array.isArray(value) || value.length > MAX_PLAN_ACTIONS) return null;
  const plan: PlanAction[] = [];
  for (const raw of value as Record<string, unknown>[]) {
    if (raw?.type === 'gather') plan.push({ type: 'gather' });
    else if (raw?.type === 'move' && DIRECTIONS.includes(raw.direction as string)) {
      plan.push({ type: 'move', direction: raw.direction as 'up' });
    } else if (raw?.type === 'discard' && typeof raw.item === 'string' && Object.hasOwn(ITEMS, raw.item)) {
      plan.push({ type: 'discard', item: raw.item as 'wood' });
    } else if (raw?.type === 'attack' && Number.isInteger(raw.x) && Number.isInteger(raw.y)) {
      const who = raw.who === undefined ? {} : Number.isInteger(raw.who) ? { who: raw.who as number } : null;
      if (!who) return null;
      plan.push({ type: 'attack', x: raw.x as number, y: raw.y as number, ...who });
    } else return null;
  }
  return plan;
}

class Room {
  stage: Stage = 'lobby';
  hostId = 0;
  members: Member[] = [];
  state: GameState | null = null;
  seed = '';
  private nextMemberId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0;
  private paused = false;

  constructor(
    readonly code: string,
    readonly setup: RoomSetup,
    private readonly stepMs: number,
    private readonly inviteOrigin: string,
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
      ready: m.ready || !this.alive(m),
      connected: !!m.connection,
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
    this.state = createGame(this.seed, this.setup.players, {
      mapSize: this.setup.mapSize,
      seats: this.members.length,
      names: this.members.map((m) => m.name),
    });
    this.beginPlanning();
    return null;
  }

  private beginPlanning() {
    this.stage = 'planning';
    this.paused = false;
    for (const m of this.members) {
      m.plan = [];
      m.ready = false;
    }
    this.armDeadline();
    for (const m of this.members) if (m.connection) this.sendCurrent(m);
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
      seed: this.seed,
      hostId: this.members.findIndex((m) => m.id === this.hostId),
      youAreHost: member.id === this.hostId,
    };
  }

  setPlan(member: Member, actions: unknown, ready: unknown): ErrorCode | null {
    if (this.stage !== 'planning') return null;
    const plan = cleanPlan(actions);
    if (!plan) return 'badPlan';
    const seat = this.seatOf(member);
    if (!this.state!.players[seat].alive) return 'badPlan';
    if (!projectPlan(getPlayerView(this.state!, seat), plan).ok) return 'badPlan';
    member.plan = plan;
    member.ready = ready === true;
    this.broadcastStatus();
    this.resolveIfEveryoneReady();
    return null;
  }

  private resolveIfEveryoneReady() {
    if (this.stage !== 'planning') return;
    const waitingOn = this.members.filter((m) => m.connection && this.alive(m));
    if (waitingOn.length > 0 && waitingOn.every((m) => m.ready)) this.resolve();
  }

  private resolve() {
    this.clearTimer();
    this.stage = 'resolving';
    const previous = this.state!;
    const plans: Record<number, PlanAction[]> = {};
    this.members.forEach((m, seat) => (plans[seat] = m.plan));
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
  noRoom: 'そのルームは見つかりませんでした。',
  roomFull: 'ルームが満員です。',
  alreadyStarted: 'このルームのゲームはもう始まっています。',
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
  private readonly emptyRoomMs: number;
  private readonly maxRooms: number;
  private readonly inviteOrigin: string;

  constructor(options: RoomOptions = {}) {
    this.stepMs = options.stepMs ?? 500;
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
        const room = new Room(this.newCode(), cleanSetup(message.setup), this.stepMs, this.inviteOrigin);
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
