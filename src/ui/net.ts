// サーバーとの接続。切れたら自動でつなぎ直し、token があればルームへ復帰する。
import type { ClientMessage, ServerMessage } from '../net/protocol';

const TOKEN_KEY = 'island-survival-token';
const RETRY_MS = 1500;
/** 無料のホスティングは受信がしばらくないと眠り、ルームが消える。接続中はそれより短い間隔で合図を送る */
const KEEP_ALIVE_MS = 5 * 60 * 1000;

// タブごとに別の席にしたいので sessionStorage を使う（同じPCの2タブでも試せる）
function loadToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // 保存できない環境では、再読み込みでの復帰だけができない
  }
}

export interface NetHandlers {
  onMessage(message: ServerMessage): void;
  onConnectionChange(connected: boolean): void;
  /** 復帰するルームがないまま接続できた */
  onReadyWithoutRoom(): void;
}

export class Net {
  private ws: WebSocket | null = null;
  private token = loadToken();
  private wasConnected = false;

  constructor(private readonly handlers: NetHandlers) {
    this.connect();
    setInterval(() => this.send({ t: 'keepAlive' }), KEEP_ALIVE_MS);
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  clearToken() {
    this.token = null;
    saveToken(null);
  }

  private connect() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.wasConnected = true;
      this.handlers.onConnectionChange(true);
      if (this.token) this.send({ t: 'resume', token: this.token });
      else this.handlers.onReadyWithoutRoom();
    });

    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;
      if (message.t === 'joined') {
        this.token = message.token;
        saveToken(message.token);
      }
      this.handlers.onMessage(message);
    });

    ws.addEventListener('close', () => {
      if (this.wasConnected) this.handlers.onConnectionChange(false);
      setTimeout(() => this.connect(), RETRY_MS);
    });
  }
}
