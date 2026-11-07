# 無人島サバイバル（仮）

仕様は docs/island-survival-spec.md に従う。第10.6節のマイルストーン順に作る。

## 構成

- `src/core/` ルール本体。画面から独立し、DOM に触らない（`tsconfig.core.json` で型レベルで禁止）
- `src/server/` ルーム管理と通信。判定はすべてここで core を呼んで行う
- `src/net/` サーバーと画面で共有するメッセージの型
- `src/ui/` 画面。サーバーから届いた `PlayerView` だけで描く（見込みの計算以外は判定しない）
- `src/ui/sprites.ts` ドット絵。すべてコードで描く（外部画像なし）。既存ゲームの絵やキャラは写さない
- `src/core/cpu.ts` CPU。人間と同じ `PlayerView` だけで判断する。シミュレータは該当マイルストーンで追加し、`src/core` を共有する

## 守ること

- 乱数は `src/core/rng.ts` のシード付き乱数だけを使う。`src/core` で `Math.random` や現在時刻を使わない
- 同じシードと同じ行動列からは、必ず同じ状態になるようにする
- クライアントへ送るのは `getPlayerView` と `replayFor` を通した情報だけ（霧の不正閲覧を防ぐ）
- 調整する数値は `src/core/data.ts` に集める（ルールブックも同じデータから作る予定）
- ユーザーが入力した名前などは `innerHTML` に混ぜない
- サーバーへ届くものはすべて信用しない。公開サーバーなので、1つのメッセージでプロセスを落とさない

## コマンド

- `npm run dev` 開発サーバー（ポート 5557。画面と通信を1つで受ける。同じWi-Fiのスマホからも入れる）
- `npm run build` と `npm start` 本番ビルドの確認
- `npm test` ルールとルーム管理の自動テスト
- `npm run typecheck` 型チェック
- `npm run sim -- --games 3000 --ap 4` CPU同士の自動対戦で勝ち方や職業の勝率を見る（`--set GOALS.warPoints=6` や `--recipe fort=wood:6,stone:3,rope:1` で値を変えて比べられる）

ルールのテストは調整値に引きずられないよう、`src/test-setup.ts` で1ターンのAPを3に戻して動かす。今の調整値は `src/sim/simulate.test.ts` で確かめる。

音は `src/ui/audio.ts` で Web Audio から鳴らす（外部の音源なし）。

複数人の確認は、同じPCならタブを分ければ別の席になる（席の記憶はタブごと）。

本番は LAN ではなくインターネットに公開する。手順と入れてある守りは docs/deploy.md にまとめている。
