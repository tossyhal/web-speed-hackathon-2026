# CaX パフォーマンス改善計画 v3

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

### 計測方針

- **ホームに限定した変更** → `--targetName "ホーム"` で高速計測
- **フローや他ページに触る変更** → フル計測 (全9ページ + 5フロー)
- Lighthouse はブレるため、悪化判定は複数回計測で確認

---

## 採点構造

| 区分 | 満点 | 内訳 | 条件 |
|------|------|------|------|
| ページの表示 | 900点 | 9ページ × 100点（FCP×10, SI×10, LCP×25, **TBT×30**, CLS×25） | - |
| ページの操作 | 250点 | 5シナリオ × 50点（**TBT×25**, INP×25） | 表示300点以上で解放 |
| **合計** | **1150点** | | |

**TBT が最重要** (表示30% + 操作50%)

---

## 現状スコア (Phase 2 完了後 — 555.95 / 1150)

### 通常テスト (525.95 / 900)

| ページ | CLS | FCP | LCP | SI | TBT | 合計 |
|--------|-----|-----|-----|-----|-----|------|
| ホーム | 19.50 | 7.90 | **0.00** | **0.00** | **0.00** | **27.40** |
| 投稿詳細 | 25.00 | 8.90 | 7.00 | 6.20 | 29.70 | 76.80 |
| 写真つき投稿詳細 | 24.75 | 8.90 | 0.25 | **0.00** | 29.10 | 63.00 |
| 動画つき投稿詳細 | 23.50 | 8.70 | 9.25 | 0.60 | 23.70 | 65.75 |
| 音声つき投稿詳細 | 25.00 | 8.80 | 7.25 | **0.00** | **0.00** | 41.05 |
| 検索 | 25.00 | 8.70 | 6.75 | 8.00 | 30.00 | 78.45 |
| DM一覧 | 25.00 | 8.90 | 15.75 | 6.50 | 13.20 | 69.35 |
| DM詳細 | 25.00 | 9.00 | 10.25 | 4.00 | **0.00** | 48.25 |
| 利用規約 | 25.00 | 8.60 | 9.50 | 8.30 | 4.50 | 55.90 |

### ユーザーフローテスト (30.00 / 250)

| テスト | INP | TBT | 合計 |
|--------|-----|-----|------|
| ユーザー登録→サインアウト→サインイン | 6.50 | 0.00 | 6.50 |
| DM送信 | - | - | **計測不可** |
| 検索→結果表示 | - | - | **計測不可** |
| Crok AIチャット | 23.50 | 0.00 | 23.50 |
| 投稿 | - | - | **計測不可** |

### ボトルネック分析

| 問題 | 失点 | 根本原因推定 |
|------|------|-------------|
| 計測不可フロー ×3 | **~150点** | scoring-tool のセレクタ/完了条件とUI不一致 |
| ホーム LCP/SI/TBT = 0 | **~70点** | 重い依存が同期チャンクに残留、APIレスポンス肥大 |
| 音声投稿 TBT = 0 | **~30点** | SoundWaveSVG の AudioContext 処理? |
| DM詳細 TBT = 0 | **~30点** | 原因不明、要調査 |
| 全フロー TBT = 0 | **~125点** | redux-form + 重いバンドルによるメインスレッドブロック |

---

## Phase 3: 新プラン (v3)

> 原則: 「壊れたフロー修復」→「最大の穴 (ホーム)」→「バンドル軽量化」→「LCP/表示最適化」の順。
> docs/research の定石: **重い実行時処理をクライアントから追い出す**。

### Step 1: 計測不可フロー修復 (期待 +100〜150点)

scoring-tool のセレクタと完了待ち条件を突き合わせ、UIを完全一致させる。

#### S1-01: 検索→結果表示フロー修復

**対象**: `SearchPage.tsx`, scoring-tool `calculate_search_post_flow_action.ts`
- scoring-tool の待ちパターン (`/「アニメ/`) と見出しテキストの一致を検証
- SearchPage のフォーム送信→URL更新→結果表示の流れを安定化
- 計測: フル計測

#### S1-02: DM送信フロー修復

**対象**: `NewDirectMessageModalPage.tsx`, scoring-tool の DM送信フロー
- scoring-tool のセレクタ (ラベル・入力欄・送信ボタン・完了判定) を確認
- 前回 30.50 → 計測不可に悪化。CoveredImage変更 or cache変更の副作用を調査
- 計測: フル計測

#### S1-03: 投稿フロー修復

**対象**: `NewPostModalPage.tsx`, scoring-tool `calculate_post_flow_action.ts`
- 画像投稿完了の確認条件 (`getByAltText(...)`) を確認
- CoveredImage が `alt` prop を受け取るようになったが、新規投稿直後のAPIレスポンスに `alt` が含まれているか検証
- 計測: フル計測

### Step 2: ホーム TBT/SI/LCP = 0 の根本解決 (期待 +40〜70点)

ホームは 27.40/100 で最悪ページ。LCP/SI/TBT が全て 0。

#### S2-01: `react-syntax-highlighter` Light ビルド化 (旧 P3-02)

**対象**: `CodeBlock.tsx`
```ts
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import js from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
SyntaxHighlighter.registerLanguage("javascript", js);
```
全言語定義 (~1 MiB) → 必要な言語のみ。Crok以外のページのバンドルに混入していないか確認。
計測: ホーム計測

#### S2-02: Crok 専用依存の async chunk 分離確認 (旧 P3-03)

katex / react-markdown / react-syntax-highlighter / rehype-katex / remark-math / remark-gfm が
Crok async チャンクに正しく入っているか確認。入っていなければ cacheGroups で分離:
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
計測: ホーム計測

#### S2-03: negaposi/kuromoji/BM25 サーバーサイド化 (旧 P3-08)

- サーバーに `/api/v1/sentiment` エンドポイント作成
- クライアント側の kuromoji, negaposi-analyzer-ja, bayesian-bm25 依存を削除
- kuromoji辞書 (17MB) のクライアント配信停止
- `bm25_search.ts`, `negaposi_analyzer.ts` をサーバーAPI呼び出しに置換
- 計測: ホーム計測 (バンドル削減効果) + フル計測 (検索フロー影響)

#### S2-04: `@mlc-ai/web-llm` の影響確認 (旧 P4-04)

**対象**: `create_translator.ts` 経由のインポート
- web-llm が同期チャンクに含まれていないか確認
- 含まれていれば dynamic import 化 or Crok チャンクに隔離
- 計測: ホーム計測

### Step 3: redux-form 撤去 (期待 +20〜40点)

#### S3-01: redux-form → React controlled form に置換 (旧 P3-06)

**対象**:
- `AuthModalPage.tsx` (サインイン/サインアップフォーム)
- `SearchPage.tsx` (検索フォーム)
- `NewDirectMessageModalPage.tsx` (DM送信フォーム)
- `store/index.ts` (redux-form reducer 除去)

redux-form (~30KB gzipped) はメインバンドルに含まれ全ページの TBT に影響。
ユーザー登録フローの TBT=0 / INP=6.5 はここが怪しい。
バンドル削減と操作系フローの両方に効く。
計測: フル計測

### Step 4: CoveredImage 最終形 + 画像最適化 (期待 +20〜40点)

#### S4-01: サーバーAPIから width/height/alt を返す (旧 P3-07 残り)

- Image API レスポンスに `width`, `height` を追加
- CoveredImage に明示的な `width`/`height` を設定
- 写真つき投稿詳細の LCP=0.25 が低すぎる → 画像寸法確定で改善
- 投稿フローの画像完了判定も安定化
- 計測: フル計測

#### S4-02: 画像 `loading="lazy"` + 明示的サイズ (旧 P4-01)

- ファーストビュー外の画像に `loading="lazy"` を追加
- `<img width={w} height={h}>` で CLS 防止
- ホームの SI 改善に寄与
- 計測: フル計測

### Step 5: API レスポンス最適化 (期待 +20〜40点)

#### S5-01: 不要フィールド削除 + ネスト削減 (旧 P4-05)

**対象**: ホーム, 投稿詳細, DM一覧/詳細, 検索 API
- above-the-fold に不要なフィールドを削除
- docs/research: WSH2025優勝者は60MB→400KBで劇的改善
- JSON パース時間短縮 → TBT 改善
- 計測: フル計測

#### S5-02: DB インデックス追加 (旧 P4-06)

- API レスポンスタイム短縮 → TTFB → LCP 改善
- 計測: フル計測

### Step 6: フォント最適化 (期待 +10〜20点)

#### S6-01: OTF → WOFF2 + サブセット (旧 P3-01)

- `public/fonts/ReiNoAreMincho-*.otf` (計12.7 MiB) → WOFF2 + サブセット
- `/terms` ページで使用する文字のみに絞る
- `index.css` の `@font-face` src を `.woff2` に更新
- 目標: 12.7 MiB → ~200-500 KB
- 利用規約ページの LCP/SI に効く
- 計測: `--targetName "利用規約"` + フル計測

### Step 7: 追加最適化 (時間に余裕がある場合)

#### S7-01: `<link rel="preload">` — CSS, クリティカルフォント (旧 P4-02)
#### S7-02: `splitChunks.maxSize` で並列ダウンロード最適化 (旧 P4-03)
#### S7-03: `standardized-audio-context` 削除 (旧 P3-04)
#### S7-04: SSR 導入 (旧 P4-07)

> **SSR は docs/research でもハイリスク。** WSH2025 では16人中15人がハイドレーション崩れで失格。
> 重依存除去と API 軽量化が終わるまで触らない。

---

## 後回し / 保留

- **キャッシュヘッダー再調整**: ホームで悪化した実績あり (improvement-log #23)。当面維持。
- **SSR**: ハイリスク。Phase 3 完了後に時間があれば検討。

---

## 期待スコア推移

| Step | 期待獲得 | 累計予想 |
|------|---------|---------|
| 現状 | - | 555.95 |
| Step 1 (フロー修復) | +100〜150 | ~680 |
| Step 2 (ホーム改善) | +40〜70 | ~730 |
| Step 3 (redux-form) | +20〜40 | ~760 |
| Step 4 (画像最適化) | +20〜40 | ~790 |
| Step 5 (API最適化) | +20〜40 | ~820 |
| Step 6 (フォント) | +10〜20 | ~835 |
| Step 7 (追加最適化) | +20〜40 | ~860 |

---

## 実装済みタスク一覧

### Phase 0 (ビルド基盤)
- [x] T01: webpack `mode:"production"` + `minimize:true` + `devtool:false`
- [x] T02: `splitChunks: { chunks: "all" }` + tree shaking フラグ有効化
- [x] T03: Babel ターゲット Chrome 130 + core-js/regenerator 除去
- [x] T04: GIF → MP4 変換 (15ファイル)
- [x] T05: JPG → WebP 変換 (60ファイル)
- [x] T06: Tailwind CDN → ビルドタイム (@tailwindcss/postcss)
- [x] T07: jQuery/bluebird/pako/moment/lodash 除去 → fetch API / Intl API
- [x] T08: FFmpeg/ImageMagick 動的import化
- [x] T09: kuromoji/BM25/negaposi-analyzer 動的import化
- [x] T10: `<script defer>`, `font-display: swap`, ProvidePlugin 削除

### Phase 1 (計測可能化)
- [x] P1-01: `asset/bytes` → `asset/resource` に変更 (-44.6 MiB)
- [x] P1-02: Babel `modules:false` + `development:false`
- [x] P1-03: `NewPostModalContainer` を lazy load 化
- [x] P1-04: `CoveredImage` から `image-size` / `piexifjs` 動的import化

### Phase 2 (サーバーサイド + FCP修正)
- [x] P2-01: `compression()` ミドルウェア追加
- [x] P2-02: キャッシュヘッダー最適化 (API no-store / 静的 etag + immutable)
- [x] P2-03: 即時レンダリング (`window.load` 待ち除去)
- [x] FCP修正: `publicPath: "/"` + `inject: "head"` + `scriptLoading: "defer"`

### Phase 2+ (個別改善)
- [x] P3-05: `AuthModalContainer` lazy load 化
- [x] #1: CoveredImage blob URL 廃止 → 直接 `<img src>` 化
- [x] #2: InfiniteScroll `2^18` ループ除去 + passive 化
- [x] #3: 検索フロー見出し文言修正

### 不採用 / キャンセル済み
- [x] フォント最適化 (利用規約用分離案) → ホーム改善なし → CANCEL
- [x] キャッシュヘッダー再調整 → ホームで悪化 → CANCEL

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
