import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 本番の CSP は data: のフォントを許していないので、小さなファイルも埋め込まない
  build: { assetsInlineLimit: 0, rollupOptions: { input: { main: 'index.html', rulebook: 'rulebook.html' } } },
  test: { include: ['src/**/*.test.ts'], setupFiles: ['src/test-setup.ts'] },
});
