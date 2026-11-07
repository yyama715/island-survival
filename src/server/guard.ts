// インターネット公開で使う入口の守り。回数制限と接続元の判定。
import type { IncomingMessage } from 'node:http';

/** 一定時間あたりの回数を数える。時刻は差し替えられる（テスト用） */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 枠内なら true */
  allow(key: string): boolean {
    const time = this.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= time) {
      // キーが増え続けないよう、期限切れはここでまとめて捨てる
      if (this.windows.size > 10_000) {
        for (const [k, w] of this.windows) if (w.resetAt <= time) this.windows.delete(k);
      }
      this.windows.set(key, { count: 1, resetAt: time + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.limit;
  }
}

/**
 * 接続元のIP。プロキシの内側で動かすときだけ X-Forwarded-For を信じる。
 * 先頭の値は偽装できるが、偽装されても個人別の制限を逃れられるだけで全体の上限は残る。
 * 末尾を使うと経路によっては全員が同じIPになり、普通の人が制限に当たるので先頭を使う。
 */
export function clientIp(request: IncomingMessage, trustProxy: boolean): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (trustProxy && typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

/**
 * 他のサイトのページからの接続を断る。ブラウザは Origin を必ず付けるので、
 * Origin がない接続（ブラウザ以外）はここでは止めず、回数制限に任せる。
 */
export function isAllowedOrigin(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
