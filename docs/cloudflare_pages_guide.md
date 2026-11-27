# Cloudflare Pages デプロイメント & 運用ガイド

本ドキュメントは、本システム（CBT週間活動記録システム）を **Cloudflare Pages** 環境へデプロイ・運用するための公式ガイドラインです。

---

## 1. Cloudflare Pages アーキテクチャ構成モデル

本システムは、**単一サーバー、単一インスタンス（Single Server / Single Instance）での運用が大前提**です。医療・メンタルヘルス情報（最高水準の要配慮個人情報）を安全に取り扱い、複雑な分散クラスタ管理を排除するため、以下の運用要件に応じて3つのデプロイモデルを選択可能です（特に単一ノード完結の【モデル B】が本システムの基本アーキテクチャに完全に合致する推奨構成となります）。

```mermaid
flowchart TD
    subgraph クライアント層
        Client[PC / タブレット / スマホ PWA]
    end

    subgraph Cloudflare エッジネットワーク [Cloudflare Global Network]
        WAF[Cloudflare WAF / DDoS Protection]
        EdgeCDN[Cloudflare Pages エッジ配信]
        ZeroTrust[Cloudflare Zero Trust / Access]
    end

    subgraph モデルA: フルスタックエッジモデル
        PagesFunctions[Next.js on Pages Functions (V8 Isolate)]
        D1[(Cloudflare D1 / 分散SQLite)]
    end

    subgraph モデルB: 【臨床推奨】ハイブリッド閉域トンネルモデル
        Tunnel[Cloudflare Tunnel (cloudflared)]
        SecureHost[セキュア院内/国内専用サーバー (Node.js)]
        LocalDB[(国内PostgreSQL / SQLite WAL)]
    end

    Client -->|HTTPS / TLS 1.3| WAF
    WAF --> EdgeCDN
    
    %% モデルAのフロー
    EdgeCDN -.->|フルスタック稼働| PagesFunctions
    PagesFunctions --> D1

    %% モデルBのフロー (推奨)
    EdgeCDN -->|フロントエンド静的・SSR高速配信| ZeroTrust
    ZeroTrust -->|暗号化トンネル| Tunnel
    Tunnel --> SecureHost
    SecureHost --> LocalDB
```

| 構成モデル | 概要 | 適用シナリオ・セキュリティ評価 |
| :--- | :--- | :--- |
| **【モデル A】<br>フルスタックエッジ** | `@cloudflare/next-on-pages` を用い、Next.js App Router 全体を Cloudflare Pages Functions 上で実行。DBは Cloudflare D1 または クラウドPostgreSQL を接続。 | **運用フリー・超低遅延**<br>サーバー保守不要で世界中から超高速アクセス。要配慮個人情報をクラウドに保管するため、暗号化と国内保管ポリシーの遵守が必要。 |
| **【モデル B】<br>【臨床推奨】<br>ハイブリッド閉域トンネル** | フロントエンドを Cloudflare Pages のグローバルエッジから配信し、APIおよびDB処理を **Cloudflare Tunnel（`cloudflared`）** 経由で国内リージョンのセキュアサーバーへ接続。 | **最高水準のデータ主権 & Zero Trust**<br>機微な活動記録・生カルテを外部DBに配置せず、院内や国内閉域環境に秘匿。外部からの直接攻撃ポートをゼロ化。 |
| **【モデル C】<br>プロトタイプ・静的プレビュー** | `prototype/index.html`（動くモックアップ）または Static HTML Export を Cloudflare Pages 上に即時プレビュー配信。 | **検証・デモ用**<br>開発段階でのUI/UX確認やステークホルダー向けプレビューに最適。 |

---

## 2. リポジトリ内設定ファイル & スクリプト

Cloudflare Pages 対応のため、本プロジェクトには以下の設定およびコマンドが整備されています。

### 2.1 設定ファイル (`wrangler.toml`)
```toml
name = "cbt-activity-record"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".vercel/output/static"

[vars]
NODE_ENV = "production"
```

### 2.2 `package.json` コマンド
| コマンド | 役割 |
| :--- | :--- |
| `npm run build:pages` | `@cloudflare/next-on-pages` による Cloudflare Pages 用エッジビルド実行 |
| `npm run pages:dev` | Wrangler ローカルエミュレータによる Pages 動作確認 |
| `npm run pages:deploy` | ビルド済み成果物（`.vercel/output/static`）を Cloudflare Pages へ直接デプロイ |
| `npm test` | 自動テストスイート実行（機能統合テスト & セキュリティペネトレーションテスト） |

---

## 3. デプロイ手順（Git連携・ダッシュボード）

Cloudflare ダッシュボードから GitHub リポジトリを連携して自動デプロイする場合の手順です。

### ステップ 1: プロジェクト作成
1. Cloudflare ダッシュボードにログインし、**[Workers & Pages]** > **[Pages]** > **[Connect to Git]** を選択。
2. 本リポジトリを選択。

### ステップ 2: ビルド設定
- **Framework preset**: `Next.js`
- **Build command**: `npm run build:pages`（または `npx @cloudflare/next-on-pages@1.13.7`）
- **Build output directory**: `.vercel/output/static`

### ステップ 3: 環境変数の設定 (Environment Variables)
以下の環境変数を **[Settings]** > **[Environment Variables]** に登録します（Production / Preview 共通）。

| 変数名 | 設定値の例 / 説明 | 必須区分 |
| :--- | :--- | :---: |
| `NODE_VERSION` | `20`（Node.js 20系を指定） | **必須** |
| `NEXTAUTH_SECRET` | 32文字以上のセッション暗号署名シークレットキー | **必須** |
| `MFA_ENCRYPTION_KEY` | 64文字のHex文字列（32バイトAES-256-GCMマスターキー） | **必須** |
| `DATABASE_URL` | 本番データベース接続文字列（Cloud SQL, Neon, Supabase, または D1） | **必須** |
| `NODE_ENV` | `production` | **必須** |

> [!CAUTION]
> `NEXTAUTH_SECRET` および `MFA_ENCRYPTION_KEY` は、要配慮個人情報（セッショントークンおよび2FA秘密鍵）を暗号化するための最重要マスターキーです。必ず暗号論的擬似乱数（例: `openssl rand -hex 32`）で生成した独立した値を設定し、公開リポジトリにコミットしないでください。

### ステップ 4: 互換性フラグの確認 (Compatibility Flags)
**[Settings]** > **[Functions]** > **[Compatibility flags]** にて以下が有効であることを確認します。
- **Compatibility date**: `2024-09-23` 以降
- **Compatibility flags**: `nodejs_compat`（Node.js 標準暗号・バッファ互換）

---

## 4. Wrangler CLI によるダイレクトデプロイ

CI/CD パイプラインやローカル端末から直接デプロイする場合の手順です。

```bash
# 1. Cloudflare にログイン (初回のみ)
npx wrangler login

# 2. Cloudflare Pages 向けビルド
npm run build:pages

# 3. ローカルエミュレータで動作検証
npm run pages:dev

# 4. Cloudflare Pages 本番環境へデプロイ
npm run pages:deploy
```

---

## 5. 要配慮個人情報（メンタルヘルス情報）保護とセキュリティ規約

Cloudflare Pages のグローバルエッジ環境で運用するにあたり、以下のセキュリティ原則がシステム全体で強制されています。

1. **APIレスポンスのキャッシュ防止 (No-Store Enforcement)**:
   - 本システムでは `next.config.mjs` のヘッダー設定（`/api/:path*` 対象）および全動的Route Handlersにおいて `Cache-Control: no-store, no-cache, must-revalidate, private` を強制しています。
   - 要配慮個人情報を返却するAPIレスポンスがエッジキャッシュに混入することを防止します（HTMLページや静的アセットのキャッシュ挙動はCloudflareのキャッシュルール設定に準拠）。
2. **Data Access Layer (DAL) による `admin_memo` 秘匿**:
   - 管理者支援メモ（`admin_memo`）は `server-only` DAL層（`src/lib/dal/cbt.ts`）で完全に除外された状態でクライアントへ返却されます。
3. **エクスポート機能完全非搭載（DLP原則）**:
   - 端末への生データダウンロード（CSV/Excel）機能は全廃されており、端末紛失や持ち出しによる情報漏洩リスクを根本遮断しています。
4. **Cloudflare Zero Trust (Access) との併用推奨**:
   - 運用管理者・医療従事者アクセスに対して Cloudflare Zero Trust（IdP連携・端末証明書チェック）を組み合わせることで、多層防御を極めて容易に実現できます。

5. **CSRF（クロスサイトリクエストフォージェリ）防御強制 (SEC-502)**:
   - 全てのミューテーションAPI（POST/PUT/PATCH/DELETE）において `verifySameOrigin` による同一オリジン検証を強制。悪意ある外部Webサイトからの不正リクエストを 403 Forbidden で遮断。
6. **セッション無操作自動ログアウト時のサーバー側即時失効 (SEC-503)**:
   - 離席時の要配慮情報画面放置を防ぐため、25分警告・30分無操作でクライアント状態を破棄するだけでなく、サーバー側の `/api/auth/logout` を即時呼び出してセッションCookieを破棄・失効。

---

## 6. トラブルシューティング

| 事象 | 原因 | 対処法 |
| :--- | :--- | :--- |
| **Windowsローカルで `spawn bash ENOENT` が発生する** | `@cloudflare/next-on-pages` が内部で Linux bash を呼び出す仕様（Windowsネイティブ環境での制約） | `scripts/build-pages.js` が自動ガイダンスを表示します。Cloudflare Pages のリモートCI（Ubuntu Linuxコンテナ）では自動的に成功します。ローカル検証は `npm run dev` または WSL / Git Bash をご利用ください。 |
| **ビルド時に peerDependencies エラーが発生する** | Next.js 14 のバージョンと `next-on-pages` の厳格なバージョン照合 | 本プロジェクトで固定されている `@cloudflare/next-on-pages@1.13.7` を使用してください（Next.js 14.2系と完全互換）。 |
| **`@node-rs/argon2` がエッジで動かない** | Cloudflare Workers（V8 Isolate）は C++ ネイティブアドオン非対応 | `src/lib/auth-service.ts` により Edge Runtime では Web Crypto API (`PBKDF2-SHA256`) へ自動フォールバックします。<br>・**テストデータ投入の注意**: `SEED_HASH_ALGO=pbkdf2 npm run db:seed` はハッシュ方式のみを変更し、通常の SQLite 用 `PrismaClient` で**既存行を全削除してサンプルデータを投入**するため、必ず**破棄可能なローカル検証用 DB** に限って実行してください（このコマンドではプレビュー D1 にデータは入りません）。専用のプレビュー D1 へテストデータだけを投入する場合は、一時 SQLite（例: `SEED_HASH_ALGO=pbkdf2 DATABASE_URL="file:./tmp-preview-seed.db" npx prisma db push --skip-generate && SEED_HASH_ALGO=pbkdf2 DATABASE_URL="file:./tmp-preview-seed.db" npm run db:seed`）から生成したテスト用 SQL を `npx wrangler d1 execute <PREVIEW_DB名> --preview --remote --file=<seed.sql>` で投入してください。<br>・**既存 Argon2id ユーザーの移行手順**: ① 有効なリセットトークンを発行し、② `setup-password` を実行する Node.js 環境に `PREFER_PBKDF2_HASH=true` を設定してパスワード再設定を実施し、③ D1 切替前に Edge 環境（Preview）でログインできることを確認してください。 |
| **ローカル SQLite (`dev.db`) と Cloudflare D1 の切り替え（Preview 検証用途限定）** | Cloudflare Pages Functions ではローカルファイル書き込み不可 | `src/lib/prisma.ts` の透過的 Proxy が、`env.DB`（D1 バインディング）の有無を自動判定して D1 とローカル SQLite を切り替えます。**※D1 構成は Preview 検証用途に限定され、本番運用は [AGENTS.md](../AGENTS.md) および [要件定義書](./requirements_specification.md) に準拠した単一インスタンスのローカル SQLite（WALモード）＋ Cloudflare Tunnel 構成を正とします（Production 設定には `DB` バインディングを追加しないでください）。** Preview 環境で D1 を使うには、① `npm run db:d1:schema` で生成した `prisma/d1-schema.sql` を `npx wrangler d1 execute <PREVIEW_DB名> --preview --remote --file=prisma/d1-schema.sql` で適用し、② `wrangler.toml` の `[[env.preview.d1_databases]]` を有効化するか Cloudflare ダッシュボードの **[Settings]** > **[Functions]** > **[D1 database bindings]** にて **Preview 環境のみ** に変数名 **`DB`** で対象 D1 をバインドして再デプロイしてください。 |
