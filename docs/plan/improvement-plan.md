# CaX パフォーマンス改善計画 v2

---

## ワークフロー

```
コード修正 → ビルド → 計測 (scoring-tool) → 採用/不採用 → ログ記録 → 次
```

### コマンド早見表

```bash
# ビルド & 起動
cd application && pnpm --filter @web-speed-hackathon-2026/client build && pnpm run start

# 計測（別ターミナル）
cd scoring-tool && pnpm start --applicationUrl http://localhost:3000
cd scoring-tool && pnpm start --applicationUrl http://localhost:3000 --targetName "ホーム"

# VRT
cd application && pnpm run test
```

---

## 採点構造

| 区分 | 満点 | 内訳 | 条件 |
|------|------|------|------|
| ページの表示 | 900点 | 9ページ × 100点（FCP×10, SI×10, LCP×25, **TBT×30**, CLS×25） | - |
| ページの操作 | 250点 | 5シナリオ × 50点（**TBT×25**, INP×25） | 表示300点以上で解放 |
| **合計** | **1150点** | | |

**TBT が最重要** (表示30% + 操作50%)

---

## 現状 (Phase 0 完了後)

### ビルド出力

| ファイル | サイズ |
|---------|--------|
| `scripts/597.js` | **72.1 MiB** (vendors) |
| `scripts/main.js` | 143 KiB |
| `scripts/chunk-*.js` | 2.85 KiB |
| `styles/main.css` | 37.9 KiB |
| `styles/597.css` | 23.2 KiB |

### 72.1 MiB の内訳 (根本原因)

| # | 原因 | 推定サイズ | ファイル |
|---|------|-----------|---------|
| 1 | WASM が `asset/bytes` で Base64 インライン | ~44.6 MiB | `webpack.config.js:53-54` |
| 2 | Babel `modules:"commonjs"` → tree shaking 無効 | 残り全体の30-50%増 | `babel.config.js:8` |
| 3 | `NewPostModalContainer` が静的import → FFmpeg/ImageMagick/encoding-japanese 連鎖 | 数MiB | `AppContainer.tsx:7` |
| 4 | `CoveredImage` が `image-size` + `piexifjs` 静的import + 画像二重DL | ~200KB+ | `CoveredImage.tsx:2-3` |
| 5 | `react-syntax-highlighter` + `katex` が静的import (Crokのみ使用) | ~1.5MiB | `ChatMessage.tsx:1-5`, `CodeBlock.tsx:2-3` |
| 6 | `negaposi-analyzer-ja` 辞書JSON | 3.29 MiB | 動的importだがチャンクに含まれる |
| 7 | Babel react preset `development:true` | dev checks 余分 | `babel.config.js:15` |

### Phase 0 完了済みタスク

- [x] webpack `mode:"production"` + `minimize:true` + `devtool:false`
- [x] `splitChunks: { chunks: "all" }` + tree shaking フラグ有効化
- [x] Babel ターゲット Chrome 130 + core-js/regenerator 除去
- [x] GIF → MP4 変換 (15ファイル)
- [x] JPG → WebP 変換 (60ファイル)
- [x] Tailwind CDN → ビルドタイム (@tailwindcss/postcss)
- [x] jQuery/bluebird/pako/moment/lodash 除去 → fetch API / Intl API
- [x] FFmpeg/ImageMagick 動的import化
- [x] kuromoji/BM25/negaposi-analyzer 動的import化
- [x] `<script defer>`, `font-display: swap`
- [x] ProvidePlugin (AudioContext/Buffer) 削除

---

## Phase 1: 計測可能にする (バッチ適用)

> 72.1 MiB では Chrome が OOM でクラッシュする。計測可能な状態にするため、
> 確実な改善を計測なしでまとめて適用し、ベースライン計測を行う。

### P1-01: `asset/bytes` → `asset/resource` に変更 (-44.6 MiB)

**webpack.config.js:53-54**
```js
// Before
{ resourceQuery: /binary/, type: "asset/bytes" }
// After
{ resourceQuery: /binary/, type: "asset/resource", generator: { filename: "assets/[hash][ext]" } }
```

**load_ffmpeg.ts** — default export が URL 文字列になるので書き換え:
```ts
export async function loadFFmpeg(): Promise<import("@ffmpeg/ffmpeg").FFmpeg> {
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  const coreURL = (await import("@ffmpeg/core?binary")).default;
  const wasmURL = (await import("@ffmpeg/core/wasm?binary")).default;
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}
```

**convert_image.ts** — magick.wasm も URL → fetch:
```ts
const [{ initializeImageMagick, ImageMagick, MagickFormat }, wasmUrl] = await Promise.all([
  import("@imagemagick/magick-wasm"),
  import("@imagemagick/magick-wasm/magick.wasm?binary").then(m => m.default),
]);
const wasmBytes = await fetch(wasmUrl).then(r => r.arrayBuffer());
await initializeImageMagick(new Uint8Array(wasmBytes));
```

### P1-02: Babel config 修正 (tree shaking 有効化)

**babel.config.js**
- `modules: "commonjs"` → `modules: false` (webpack が ESM を直接解析)
- `development: true` → `development: false` (React dev checks 除去)

### P1-03: `NewPostModalContainer` を lazy load 化

**AppContainer.tsx:7** — 静的import → `React.lazy()`:
```ts
const NewPostModalContainer = lazy(async () => {
  const mod = await import("@web-speed-hackathon-2026/client/src/containers/NewPostModalContainer");
  return { default: mod.NewPostModalContainer };
});
```
121行目を `<Suspense fallback={null}>` で囲む。

### P1-04: `CoveredImage` から `image-size` / `piexifjs` 静的import 除去

**CoveredImage.tsx:2-3** — 静的import → 動的import:
```ts
// Before (static)
import sizeOf from "image-size";
import { load, ImageIFD } from "piexifjs";

// After (dynamic, コールバック内で)
const { default: sizeOf } = await import("image-size");
const { load, ImageIFD } = await import("piexifjs");
```

### P1 目標
- 最大チャンク: **2-5 MiB** (現状72.1 MiB)
- scoring-tool が動作すること

### P1 完了後
1. ビルド → チャンクサイズ確認
2. サーバー起動 → scoring-tool で「ホーム」計測 → ベースラインスコア記録
3. 全ページ計測 → `improvement-log.md` にベースライン記録
4. 以降は 1タスク→計測→判定 サイクル

---

## Phase 2: サーバーサイド即効改善 (1個ずつ計測サイクル)

### P2-01: gzip/brotli 圧縮ミドルウェア追加

**app.ts**
```ts
import compression from "compression";
app.use(compression());  // 全ルートの前に配置
```
- `pnpm add compression @types/compression` (server側)

### P2-02: キャッシュヘッダー最適化

**app.ts:16-22** — グローバル `max-age=0` を API のみに限定
**static.ts** — contenthash付きJS/CSSは `maxAge: "1y", immutable: true`, `etag: true`

### P2-03: `window.addEventListener("load")` → 即時レンダリング

**index.tsx:8** — `load` イベント待ちをやめて直接 `createRoot` 呼び出し。
FCP/LCP が大幅改善 (全リソース読み込み完了を待たなくなる)。

---

## Phase 3: バンドル追加最適化 (1個ずつ計測サイクル)

### P3-01: フォント WOFF2 化 + サブセット (-12 MiB)

- `public/fonts/ReiNoAreMincho-*.otf` (計12.7 MiB) → WOFF2 + サブセット
- `/terms` ページで使用する文字のみに絞る
- `index.css` の `@font-face` src を `.woff2` に更新
- 目標: 12.7 MiB → ~200-500 KB

### P3-02: `react-syntax-highlighter` を Light ビルドに変更

**CodeBlock.tsx:2-3**
```ts
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import js from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
SyntaxHighlighter.registerLanguage("javascript", js);
```
全言語定義 (~1 MiB) → 必要な言語のみ

### P3-03: Crok チャンクの分離確認 & cacheGroups 設定

P1-02 後に katex/react-markdown/react-syntax-highlighter が Crok async チャンクに入っているか確認。
入っていなければ:
```js
splitChunks: {
  chunks: "all",
  cacheGroups: {
    crokVendor: {
      test: /[\\/]node_modules[\\/](katex|react-markdown|react-syntax-highlighter|rehype-katex|remark-math|remark-gfm)/,
      name: "crok-vendor",
      chunks: "async",
      priority: 20,
    },
  },
}
```

### P3-04: `standardized-audio-context` 削除

`SoundWaveSVG.tsx` は標準 `AudioContext` を使用。ProvidePlugin も削除済み。`package.json` から削除するだけ。

### P3-05: `AuthModalContainer` を lazy load 化

**AppContainer.tsx:6** — NewPostModal と同様に `lazy()` 化

### P3-06: `redux-form` → React controlled form に置換

SearchPage.tsx で使用。redux-form (~30KB) を除去。

### P3-07: CoveredImage を完全に `<img>` + サーバーAPI 化 (二重DL根絶)

- サーバー API レスポンスに `width`, `height`, `description` を追加
- CoveredImage は `<img src={url} alt={desc} width={w} height={h} style={{objectFit:"cover"}} />`
- `image-size`, `piexifjs`, `fetchBinary` 不要に

### P3-08: negaposi/kuromoji/BM25 をサーバーサイド化

- サーバーに `/api/v1/sentiment` エンドポイント作成
- クライアント側の kuromoji, negaposi-analyzer-ja, bayesian-bm25 依存を削除
- kuromoji辞書 (17MB) のクライアント配信停止

---

## Phase 4: 表示スコア最適化 (1個ずつ計測サイクル)

### P4-01: 画像 `loading="lazy"` + 明示的 `width`/`height` (CLS対策)
### P4-02: `<link rel="preload">` — CSS, クリティカルフォント
### P4-03: `splitChunks.maxSize` で並列ダウンロード最適化
### P4-04: `@mlc-ai/web-llm` の影響確認 & 対策
### P4-05: API レスポンス最適化 (不要フィールド削除, N+1対策)
### P4-06: DB インデックス追加
### P4-07: SSR 導入 (ハイリスク。時間に余裕がある場合のみ)

---

## 予想サイズ推移

| 段階 | 最大チャンク | 根拠 |
|------|-------------|------|
| 現状 | 72.1 MiB | ベースライン |
| P1-01 (asset/resource) | ~27 MiB | WASM 44.6 MiB がファイル分離 |
| P1-02 (babel modules:false) | ~8-12 MiB | tree shaking 有効化 |
| P1-03 (lazy NewPostModal) | ~3-5 MiB | FFmpeg/ImageMagick async化 |
| P1-04 (fix CoveredImage) | ~2-4 MiB | image-size/piexifjs 除去 |
| Phase 2-4 | ~500KB-1MiB | 圧縮, code splitting 精緻化 |

---

## レギュレーション遵守チェック (毎改善後に実施)

| # | チェック項目 | コマンド/方法 |
|---|-------------|---------------|
| 1 | VRT テスト | `cd application && pnpm run test` |
| 2 | 手動テスト主要項目 | `docs/test_cases.md` を目視確認 |
| 3 | 初期化 API | `curl -X POST http://localhost:3000/api/v1/initialize` |
| 4 | Crok SSE | ブラウザで確認 |
| 5 | fly.toml 未変更 | `git diff fly.toml` |
| 6 | 動画自動再生 | ホーム・投稿詳細で確認 |
| 7 | 音声波形表示 | ホーム・投稿詳細で確認 |
| 8 | 写真表示 | object-fit: cover で表示確認 |

> **重要**: 過去 WSH では上位入賞者の大半がレギュレーション違反で失格。スコア改善よりレギュレーション遵守を優先。
