// RoomManager を WebSocket につなぐ。
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage } from '../net/protocol';
import { clientIp, isAllowedOrigin, RateLimiter } from './guard';
import type { Connection, RoomManager } from './rooms';

const MAX_MESSAGE_BYTES = 16 * 1024;
const HEARTBEAT_MS = 30_000;
/** 圧縮すると盤面のデータは約97%小さくなる。小さい通知は圧縮しない */
const COMPRESS_FROM_BYTES = 1024;

export const WS_PATH = '/ws';

export interface SocketOptions {
  /** プロキシの内側で動かすとき true（X-Forwarded-For を信じる） */
  trustProxy?: boolean;
  /** 別のドメインの画面からつなぐ場合だけ指定する */
  allowedOrigins?: readonly string[];
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  /** 1つの接続が10秒間に送れるメッセージ数 */
  messagesPer10s?: number;
  /** 1つのIPが1分間にできるルーム作成と参加の回数（合言葉の総当たりを防ぐ） */
  entriesPerMinute?: number;
}

export function attachSockets(server: Server, manager: RoomManager, options: SocketOptions = {}) {
  const {
    trustProxy = false,
    allowedOrigins = [],
    maxConnections = 2000,
    maxConnectionsPerIp = 30,
    messagesPer10s = 100,
    entriesPerMinute = 20,
  } = options;

  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: { threshold: COMPRESS_FROM_BYTES },
  });
  const alive = new WeakSet<WebSocket>();
  const connectionsByIp = new Map<string, number>();
  const entries = new RateLimiter(entriesPerMinute, 60_000);

  const refuse = (socket: Duplex, status: string) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // それ以外のパスは Vite の更新通知などに任せる
    if (new URL(request.url ?? '/', 'http://localhost').pathname !== WS_PATH) return;
    if (!isAllowedOrigin(request, allowedOrigins)) return refuse(socket, '403 Forbidden');
    const ip = clientIp(request, trustProxy);
    if (sockets.clients.size >= maxConnections || (connectionsByIp.get(ip) ?? 0) >= maxConnectionsPerIp) {
      return refuse(socket, '503 Service Unavailable');
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit('connection', ws, ip));
  });

  sockets.on('connection', (ws: WebSocket, ip: string) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
    const messages = new RateLimiter(messagesPer10s, 10_000);

    const connection: Connection = {
      send(message) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
      },
    };

    ws.on('message', (data) => {
      if (!messages.allow('all')) {
        ws.close(1008, 'too many messages');
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data));
      } catch {
        connection.send({ t: 'error', code: 'badMessage', message: '送信内容が正しくありません。' });
        return;
      }
      if ((message?.t === 'create' || message?.t === 'join') && !entries.allow(ip)) {
        connection.send({ t: 'error', code: 'tooManyRequests', message: '操作が多すぎます。少し待ってからお試しください。' });
        return;
      }
      // 1つのおかしなメッセージで他のルームまで巻き込まないようにする
      try {
        manager.handle(connection, message);
      } catch (error) {
        console.error('メッセージの処理に失敗しました', error);
      }
    });
    ws.on('close', () => {
      const count = (connectionsByIp.get(ip) ?? 1) - 1;
      if (count > 0) connectionsByIp.set(ip, count);
      else connectionsByIp.delete(ip);
      try {
        manager.disconnected(connection);
      } catch (error) {
        console.error('切断の処理に失敗しました', error);
      }
    });
    ws.on('error', () => ws.terminate());
  });

  // スマホのスリープなどで黙って切れた接続を見つける。プロキシに無通信で切られるのも防ぐ
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    close() {
      clearInterval(heartbeat);
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
    },
  };
}
