// サーバーの入口。開発中は Vite を組み込み、1つのポートで画面と通信の両方を受ける。
import { createServer, type RequestListener } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomManager } from './rooms';
import { attachSockets } from './socket';
import { createStaticHandler } from './static';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const PORT = Number(process.env.PORT) || 5557;
const PRODUCTION = process.argv.includes('--prod');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);

function lanAddress(): string | null {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return null;
}

const lan = lanAddress();
const server = createServer();
// 招待URLは、公開先では画面側が自分のアドレスから作る。これは localhost で開いたときの代わり
const manager = new RoomManager({ inviteOrigin: `http://${lan ?? 'localhost'}:${PORT}` });
const sockets = attachSockets(server, manager, { trustProxy: TRUST_PROXY, allowedOrigins: ALLOWED_ORIGINS });

let serveApp: RequestListener;
if (PRODUCTION) {
  serveApp = createStaticHandler(join(ROOT, 'dist'));
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    root: ROOT,
    // vite.config.ts はテスト用。読むと一時ファイルが作られ、node --watch が再起動を繰り返す
    configFile: false,
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });
  serveApp = (request, response) => vite.middlewares(request, response);
}

server.on('request', (request, response) => {
  // ホスティング先の死活監視用
  if (request.url === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok');
    return;
  }
  serveApp(request, response);
});

server.listen(PORT, () => {
  console.log(`無人島サバイバル: http://localhost:${PORT}`);
  if (lan && !PRODUCTION) console.log(`同じWi-Fiのスマホから: http://${lan}:${PORT}`);
});

// 更新時にホスティング先から止められたら、接続を閉じてすぐ終わる。進行中のルームは消える
function shutdown() {
  sockets.close();
  manager.dispose();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
