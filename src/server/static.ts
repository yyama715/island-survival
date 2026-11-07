// 本番でビルド済みの画面を配信する。
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function safePathname(url: string | undefined): string | null {
  try {
    return decodeURIComponent(new URL(url ?? '/', 'http://localhost').pathname);
  } catch {
    return null;
  }
}

export function createStaticHandler(dist: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = safePathname(request.url);
    if (pathname === null) {
      response.writeHead(400).end();
      return;
    }

    const target = normalize(join(dist, pathname));
    const inside = target === dist || target.startsWith(dist + sep);
    const isFile = inside && existsSync(target) && statSync(target).isFile();
    const file = isFile ? target : join(dist, 'index.html');
    if (!existsSync(file)) {
      response.writeHead(503).end('まだビルドされていません（npm run build）');
      return;
    }

    response.setHeader('Content-Type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream');
    // assets 以下はファイル名に内容のハッシュが付くので長く持てる
    const hashed = isFile && pathname.startsWith('/assets/');
    response.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).on('error', () => response.destroy()).pipe(response);
  };
}
