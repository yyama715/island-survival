import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../net/protocol';
import { clientIp, isAllowedOrigin, RateLimiter } from './guard';
import { RoomManager } from './rooms';
import { attachSockets, WS_PATH, type SocketOptions } from './socket';
import { createStaticHandler } from './static';

const request = (headers: Record<string, string>, remoteAddress = '10.0.0.1') =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

describe('回数制限', () => {
  it('上限までは通し、時間が過ぎると戻る', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1000, () => now);
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, false]);
    expect(limiter.allow('b')).toBe(true);
    now = 1000;
    expect(limiter.allow('a')).toBe(true);
  });
});

describe('接続元', () => {
  it('X-Forwarded-For はプロキシを信じる設定のときだけ使う', () => {
    const r = request({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
    expect(clientIp(r, false)).toBe('10.0.0.1');
    expect(clientIp(r, true)).toBe('1.2.3.4');
    expect(clientIp(request({}), true)).toBe('10.0.0.1');
  });

  it('同じサイトと許可したサイトのページだけ接続できる', () => {
    const host = { host: 'game.example.com' };
    expect(isAllowedOrigin(request({ ...host, origin: 'https://game.example.com' }), [])).toBe(true);
    expect(isAllowedOrigin(request({ ...host, origin: 'https://evil.example.com' }), [])).toBe(false);
    expect(isAllowedOrigin(request({ ...host, origin: 'https://friend.example.com' }), ['https://friend.example.com'])).toBe(true);
    expect(isAllowedOrigin(request({ ...host, origin: 'not a url' }), [])).toBe(false);
    expect(isAllowedOrigin(request(host), [])).toBe(true);
  });
});

describe('WebSocket の守り', () => {
  let server: Server;
  let manager: RoomManager;
  let close: () => void;
  let url: string;
  const open: WebSocket[] = [];

  async function boot(options: SocketOptions) {
    manager = new RoomManager();
    server = createServer();
    close = attachSockets(server, manager, options).close;
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${WS_PATH}`;
  }

  afterEach(async () => {
    for (const ws of open.splice(0)) ws.terminate();
    close();
    manager.dispose();
    await new Promise((resolve) => server.close(resolve));
  });

  function connect(headers?: Record<string, string>) {
    const ws = new WebSocket(url, { headers });
    open.push(ws);
    return ws;
  }

  const opened = (ws: WebSocket) =>
    new Promise<boolean>((resolve) => {
      ws.once('open', () => resolve(true));
      ws.once('error', () => resolve(false));
    });

  it('他のサイトからの接続を断る', async () => {
    await boot({});
    expect(await opened(connect({ Origin: 'https://evil.example.com' }))).toBe(false);
    expect(await opened(connect())).toBe(true);
  });

  it('1つのIPからの接続数を制限し、切れると枠が空く', async () => {
    await boot({ maxConnectionsPerIp: 1 });
    const first = connect();
    expect(await opened(first)).toBe(true);
    expect(await opened(connect())).toBe(false);
    await new Promise((resolve) => {
      first.once('close', resolve);
      first.close();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await opened(connect())).toBe(true);
  });

  it('合言葉の総当たりを止める', async () => {
    await boot({ entriesPerMinute: 3 });
    const ws = connect();
    await opened(ws);
    const inbox: ServerMessage[] = [];
    const done = new Promise<void>((resolve) => {
      ws.on('message', (data) => {
        inbox.push(JSON.parse(String(data)));
        if (inbox.length === 5) resolve();
      });
    });
    for (let i = 0; i < 5; i++) ws.send(JSON.stringify({ t: 'join', code: `AAA${i}`, name: 'x' }));
    await done;
    const codes = inbox.map((m) => (m.t === 'error' ? m.code : m.t));
    expect(codes).toEqual(['noRoom', 'noRoom', 'noRoom', 'tooManyRequests', 'tooManyRequests']);
  });

  it('送りすぎる接続は切る', async () => {
    await boot({ messagesPer10s: 3 });
    const ws = connect();
    await opened(ws);
    const closed = new Promise<number>((resolve) => ws.once('close', resolve));
    for (let i = 0; i < 5; i++) ws.send('{}');
    expect(await closed).toBe(1008);
  });
});

describe('画面の配信', () => {
  let dist: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    dist = mkdtempSync(join(tmpdir(), 'island-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>index');
    writeFileSync(join(dist, 'assets', 'app-abc.js'), 'console.log(1)');
    writeFileSync(join(dist, '..', 'island-secret.txt'), 'secret');
    server = createServer(createStaticHandler(dist));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dist, { recursive: true, force: true });
    rmSync(join(dist, '..', 'island-secret.txt'), { force: true });
  });

  it('安全のためのヘッダーを付け、ハッシュ付きのファイルだけ長くキャッシュする', async () => {
    const page = await fetch(base);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${base}/assets/app-abc.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
  });

  it('dist の外は読めず、壊れたURLでも落ちない', async () => {
    for (const path of ['/..%2fisland-secret.txt', '/%2e%2e/island-secret.txt', '/assets/..%2f..%2fisland-secret.txt']) {
      expect(await (await fetch(base + path)).text()).not.toContain('secret');
    }
    expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(base)).status).toBe(200);
  });

  it('知らないパスは画面を返し、GET以外は断る', async () => {
    expect(await (await fetch(`${base}/room/ABCD`)).text()).toContain('index');
    expect((await fetch(base, { method: 'POST' })).status).toBe(405);
  });
});
