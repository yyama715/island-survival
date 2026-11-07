import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../net/protocol';
import { RoomManager, type Connection } from './rooms';
import { attachSockets, WS_PATH } from './socket';

type Sent<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

class FakeClient implements Connection {
  inbox: ServerMessage[] = [];
  constructor(private readonly manager: RoomManager) {}
  send(message: ServerMessage) {
    // 実際の通信と同じく JSON にしても壊れないことも確かめる
    this.inbox.push(JSON.parse(JSON.stringify(message)));
  }
  say(message: ClientMessage) {
    this.manager.handle(this, message);
  }
  all<T extends ServerMessage['t']>(t: T): Sent<T>[] {
    return this.inbox.filter((m) => m.t === t) as Sent<T>[];
  }
  last<T extends ServerMessage['t']>(t: T): Sent<T> {
    return this.all(t).at(-1)!;
  }
}

const SETUP = { players: 3, mapSize: 'small' as const, planSeconds: 60 };

describe('ルーム', () => {
  let manager: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new RoomManager({ stepMs: 100, inviteOrigin: 'http://example.test' });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  function roomWith(count: number) {
    const host = new FakeClient(manager);
    host.say({ t: 'create', name: 'あお', setup: SETUP });
    const code = host.last('joined').code;
    const clients = [host];
    for (let i = 1; i < count; i++) {
      const client = new FakeClient(manager);
      client.say({ t: 'join', code, name: `友${i}` });
      clients.push(client);
    }
    return { code, clients };
  }

  function started(count: number) {
    const room = roomWith(count);
    room.clients[0].say({ t: 'start' });
    return room;
  }

  /** 次の計画フェーズが届くまで進める */
  function finishReplay() {
    vi.advanceTimersByTime(60_000 - 1);
  }

  it('合言葉で入ると全員に参加者が伝わり、招待URLが付く', () => {
    const { code, clients } = roomWith(2);
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    const lobby = clients[0].last('lobby');
    expect(lobby.members.map((m) => m.name)).toEqual(['あお', '友1']);
    expect(lobby.inviteUrl).toBe(`http://example.test/?room=${code}`);
  });

  it('合言葉は小文字でも入れるが、間違いと満員は断られる', () => {
    const { code } = roomWith(1);
    const friend = new FakeClient(manager);
    friend.say({ t: 'join', code: code.toLowerCase(), name: 'a' });
    expect(friend.last('joined')).toBeTruthy();

    const stranger = new FakeClient(manager);
    stranger.say({ t: 'join', code: 'ZZZZ', name: 'b' });
    expect(stranger.last('error').code).toBe('noRoom');

    const third = new FakeClient(manager);
    third.say({ t: 'join', code, name: 'c' });
    const fourth = new FakeClient(manager);
    fourth.say({ t: 'join', code, name: 'd' });
    expect(fourth.last('error').code).toBe('roomFull');
  });

  it('シード値を指定しても、指定した本人にしか見えない', () => {
    const host = new FakeClient(manager);
    host.say({ t: 'create', name: 'h', setup: { ...SETUP, seed: 'secret' } });
    const friend = new FakeClient(manager);
    friend.say({ t: 'join', code: host.last('joined').code, name: 'f' });
    expect(host.last('lobby').setup.seed).toBe('secret');
    expect(JSON.stringify(friend.inbox)).not.toContain('secret');
  });

  it('ターンの長さは選んだ秒数になり、120秒なら60秒では進まない', () => {
    const host = new FakeClient(manager);
    host.say({ t: 'create', name: 'h', setup: { ...SETUP, planSeconds: 120 } });
    expect(host.last('lobby').setup.planSeconds).toBe(120);
    host.say({ t: 'start' });
    expect(host.last('planning').remainingMs).toBe(120_000);
    vi.advanceTimersByTime(60_000);
    expect(host.all('replay')).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(host.all('replay')).toHaveLength(1);
  });

  it('選択肢にない長さは初期値になる', () => {
    for (const planSeconds of [1, 999999, 'x', undefined]) {
      const host = new FakeClient(manager);
      host.say({ t: 'create', name: 'h', setup: { ...SETUP, planSeconds: planSeconds as number } });
      expect(host.last('lobby').setup.planSeconds).toBe(60);
    }
  });

  it('開始できるのはルームを作った人だけで、始まると途中参加できない', () => {
    const { code, clients } = roomWith(2);
    clients[1].say({ t: 'start' });
    expect(clients[1].last('error').code).toBe('notHost');
    clients[0].say({ t: 'start' });
    expect(clients[0].last('planning')).toBeTruthy();
    const late = new FakeClient(manager);
    late.say({ t: 'join', code, name: 'late' });
    expect(late.last('error').code).toBe('alreadyStarted');
  });

  it('開始すると各自が自分の見え方と全員分の行動順を受け取り、シード値は届かない', () => {
    const { clients } = started(2);
    const [a, b] = clients.map((c) => c.last('planning'));
    expect(a.view.me.id).toBe(0);
    expect(b.view.me.id).toBe(1);
    expect(a.view.initiative).toEqual(b.view.initiative);
    expect(a.view.initiative).toHaveLength(2);
    expect(a.remainingMs).toBe(60_000);
    expect(JSON.stringify(a)).not.toContain('seed');
    // 相手の位置が見えない限り、相手の駒は届かない
    expect(a.view.cells.flatMap((c) => c.figures).every((f) => f.kind === 'self')).toBe(true);
  });

  it('全員が確定すると制限時間を待たずに解決され、再生のあと次のターンになる', () => {
    const { clients } = started(2);
    clients[0].say({ t: 'plan', actions: [{ type: 'gather' }], ready: true });
    expect(clients[0].all('replay')).toHaveLength(0);
    expect(clients[1].last('status').status.find((s) => s.id === 0)!.ready).toBe(true);

    clients[1].say({ t: 'plan', actions: [], ready: true });
    const replay = clients[0].last('replay');
    expect(replay.steps.length).toBeGreaterThan(0);
    expect(clients[0].all('planning')).toHaveLength(1);

    vi.advanceTimersByTime(5_000);
    const next = clients[0].last('planning');
    expect(next.view.turn).toBe(2);
    expect(next.view.phase).toBe('night');
    expect(next.ready).toBe(false);
    expect(next.plan).toEqual([]);
  });

  it('時間切れになると、確定していない予約もそのまま実行される', () => {
    const { clients } = started(2);
    clients[0].say({ t: 'plan', actions: [{ type: 'gather' }], ready: false });
    vi.advanceTimersByTime(59_999);
    expect(clients[0].all('replay')).toHaveLength(0);
    vi.advanceTimersByTime(1);
    const own = clients[0].last('replay').steps.flatMap((s) => s.events).map((e) => e.type);
    expect(own.some((type) => type.startsWith('gather') || type === 'gathered' || type === 'foundNest' || type === 'drank')).toBe(true);
  });

  it('確定を取り消して予約し直せる', () => {
    const { clients } = started(2);
    clients[0].say({ t: 'plan', actions: [{ type: 'gather' }], ready: true });
    clients[0].say({ t: 'plan', actions: [], ready: false });
    clients[1].say({ t: 'plan', actions: [], ready: true });
    expect(clients[0].all('replay')).toHaveLength(0);
  });

  it('おかしな予約は断り、それまでの予約は変えない', () => {
    const { clients } = started(2);
    const [host] = clients;
    host.say({ t: 'plan', actions: [{ type: 'gather' }], ready: false });
    const bad: unknown[] = [
      [{ type: 'gather' }, { type: 'gather' }, { type: 'gather' }, { type: 'gather' }],
      [{ type: 'teleport' }],
      [{ type: 'move', direction: 'north' }],
      [{ type: 'discard', item: 'constructor' }],
      'nope',
      Array.from({ length: 100 }, () => ({ type: 'gather' })),
    ];
    for (const actions of bad) {
      host.say({ t: 'plan', actions: actions as never, ready: false });
      expect(host.last('error').code).toBe('badPlan');
    }
    vi.advanceTimersByTime(60_000);
    const steps = host.last('replay').steps.flatMap((s) => s.events);
    expect(steps.filter((e) => e.type === 'gathered' || e.type === 'gatherNothing' || e.type === 'foundNest' || e.type === 'drank').length).toBe(1);
  });

  it('他の人の採取結果は届かない', () => {
    const { clients } = started(2);
    clients[0].say({ t: 'plan', actions: [{ type: 'gather' }, { type: 'gather' }, { type: 'gather' }], ready: true });
    clients[1].say({ t: 'plan', actions: [], ready: true });
    const seen = clients[1].last('replay').steps.flatMap((s) => s.events).map((e) => e.type);
    expect(seen).not.toContain('gathered');
    expect(seen).not.toContain('gatherNothing');
  });

  it('切断しても席は残り、token で予約ごと復帰できる', () => {
    const { clients } = started(2);
    const [, friend] = clients;
    friend.say({ t: 'plan', actions: [{ type: 'gather' }], ready: false });
    const token = friend.last('joined').token;
    manager.disconnected(friend);
    expect(clients[0].last('status').status.find((s) => s.id === 1)!.connected).toBe(false);

    const back = new FakeClient(manager);
    back.say({ t: 'resume', token });
    expect(back.last('joined').memberId).toBe(1);
    const planning = back.last('planning');
    expect(planning.plan).toEqual([{ type: 'gather' }]);
    expect(planning.remainingMs).toBeLessThanOrEqual(60_000);
    expect(clients[0].last('status').status.find((s) => s.id === 1)!.connected).toBe(true);
  });

  it('切断した人を待たず、残りの全員が確定すれば進む', () => {
    const { clients } = started(2);
    clients[0].say({ t: 'plan', actions: [], ready: true });
    expect(clients[0].all('replay')).toHaveLength(0);
    manager.disconnected(clients[1]);
    expect(clients[0].all('replay')).toHaveLength(1);
  });

  it('解決の再生中に戻った人には盤面が渡り、次のターンから合流する', () => {
    const { clients } = started(2);
    const token = clients[1].last('joined').token;
    clients[0].say({ t: 'plan', actions: [], ready: true });
    manager.disconnected(clients[1]);
    const back = new FakeClient(manager);
    back.say({ t: 'resume', token });
    expect(back.last('waiting').view.me.id).toBe(1);
    vi.advanceTimersByTime(5_000);
    expect(back.last('planning').view.turn).toBe(2);
  });

  it('誰もいないあいだはターンが進まず、戻ると制限時間が仕切り直される', () => {
    const { clients } = started(1);
    const token = clients[0].last('joined').token;
    manager.disconnected(clients[0]);
    vi.advanceTimersByTime(10 * 60_000);
    const back = new FakeClient(manager);
    back.say({ t: 'resume', token });
    const planning = back.last('planning');
    expect(planning.view.turn).toBe(1);
    expect(planning.remainingMs).toBe(60_000);
  });

  it('全員いなくなったルームはしばらくして消え、token も無効になる', () => {
    const { clients } = roomWith(1);
    const token = clients[0].last('joined').token;
    manager.disconnected(clients[0]);
    expect(manager.roomCount).toBe(1);
    vi.advanceTimersByTime(31 * 60_000);
    expect(manager.roomCount).toBe(0);
    const back = new FakeClient(manager);
    back.say({ t: 'resume', token });
    expect(back.last('error').code).toBe('noRoom');
  });

  it('ロビーで作成者が抜けると次の人が引き継ぐ', () => {
    const { clients } = roomWith(2);
    clients[0].say({ t: 'leave' });
    expect(clients[0].last('left')).toBeTruthy();
    const lobby = clients[1].last('lobby');
    expect(lobby.members.map((m) => m.name)).toEqual(['友1']);
    expect(lobby.hostId).toBe(0);
    clients[1].say({ t: 'start' });
    expect(clients[1].last('planning').view.roster).toHaveLength(1);
  });

  it('壊れたメッセージや入室前の操作ではサーバーが落ちない', () => {
    const client = new FakeClient(manager);
    client.say({ t: 'start' });
    expect(client.last('error').code).toBe('noRoom');
    client.say({ t: 'plan', actions: [], ready: true });
    client.say(null as never);
    client.say({ t: 'unknown' } as never);
    client.say({ t: 'resume', token: 123 } as never);
    expect(client.all('error').every((e) => e.code === 'noRoom')).toBe(true);
    const { clients } = roomWith(1);
    clients[0].say({ t: 'unknown' } as never);
    expect(clients[0].last('error').code).toBe('badMessage');
  });

  it('名前は長さを制限し、空なら番号になる', () => {
    const host = new FakeClient(manager);
    host.say({ t: 'create', name: '  ', setup: SETUP });
    expect(host.last('lobby').members[0].name).toBe('P1');
    const friend = new FakeClient(manager);
    friend.say({ t: 'join', code: host.last('joined').code, name: 'x'.repeat(50) });
    expect(friend.last('lobby').members[1].name).toHaveLength(12);
  });

  it('最後の1人になると結果が届き、シード値が公開され、作成者がルームに戻せる', () => {
    const { code, clients } = started(2);
    const rooms = (manager as unknown as { rooms: Map<string, { state: { players: { alive: boolean }[] } }> }).rooms;
    rooms.get(code)!.state.players[1].alive = false;
    clients[0].say({ t: 'plan', actions: [], ready: true });
    vi.advanceTimersByTime(5_000);

    const [won, lost] = clients.map((c) => c.last('result'));
    expect(won).toMatchObject({ winnerId: 0, winnerName: 'あお', youAreHost: true });
    expect(lost).toMatchObject({ winnerId: 0, youAreHost: false });
    expect(won.seed).toBe(lost.seed);
    expect(won.seed.length).toBeGreaterThan(0);

    clients[1].say({ t: 'backToLobby' });
    expect(clients[1].last('error').code).toBe('notHost');
    clients[0].say({ t: 'backToLobby' });
    expect(clients[1].last('lobby').members).toHaveLength(2);
    clients[0].say({ t: 'start' });
    expect(clients[1].last('planning').view.turn).toBe(1);
  });

  it('制限時間ごとに進み続け、ターンを重ねられる', () => {
    const { clients } = started(2);
    for (let i = 0; i < 4; i++) {
      finishReplay();
      vi.advanceTimersByTime(10_000);
    }
    expect(clients[0].last('planning').view.turn).toBeGreaterThan(1);
  });
});

describe('WebSocket 経由', () => {
  let server: Server;
  let sockets: ReturnType<typeof attachSockets>;
  let manager: RoomManager;
  let url: string;
  const open: WebSocket[] = [];

  beforeEach(async () => {
    manager = new RoomManager({ stepMs: 5 });
    server = createServer();
    sockets = attachSockets(server, manager);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${WS_PATH}`;
  });

  afterEach(async () => {
    for (const ws of open.splice(0)) ws.terminate();
    sockets.close();
    manager.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  async function connect() {
    const ws = new WebSocket(url);
    open.push(ws);
    const inbox: ServerMessage[] = [];
    const waiters: (() => void)[] = [];
    ws.on('message', (data) => {
      inbox.push(JSON.parse(String(data)));
      waiters.splice(0).forEach((wake) => wake());
    });
    await new Promise((resolve) => ws.once('open', resolve));
    return {
      ws,
      say: (message: ClientMessage) => ws.send(JSON.stringify(message)),
      async until<T extends ServerMessage['t']>(t: T, match: (m: Sent<T>) => boolean = () => true): Promise<Sent<T>> {
        for (;;) {
          const hit = inbox.find((m) => m.t === t && match(m as Sent<T>));
          if (hit) return hit as Sent<T>;
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
      },
    };
  }

  it('2人で参加してターンを1周し、切断から復帰できる', async () => {
    const host = await connect();
    host.say({ t: 'create', name: 'host', setup: SETUP });
    const { code } = await host.until('joined');

    const friend = await connect();
    friend.say({ t: 'join', code, name: 'friend' });
    const { token } = await friend.until('joined');
    await host.until('lobby', (m) => m.members.length === 2);

    host.say({ t: 'start' });
    await host.until('planning');
    await friend.until('planning');

    host.say({ t: 'plan', actions: [{ type: 'gather' }], ready: true });
    friend.say({ t: 'plan', actions: [], ready: true });
    await host.until('replay');
    const next = await friend.until('planning', (m) => m.view.turn === 2);
    expect(next.view.phase).toBe('night');

    friend.ws.terminate();
    await host.until('status', (m) => m.status.some((s) => s.id === 1 && !s.connected));

    const back = await connect();
    back.say({ t: 'resume', token });
    const resumed = await back.until('planning');
    expect(resumed.view.me.id).toBe(1);
    expect(resumed.view.turn).toBe(2);
  });

  it('JSON でないメッセージにはエラーを返し、接続は保たれる', async () => {
    const client = await connect();
    client.ws.send('{broken');
    expect((await client.until('error')).code).toBe('badMessage');
    client.say({ t: 'create', name: 'x', setup: SETUP });
    expect(await client.until('joined')).toBeTruthy();
  });
});
