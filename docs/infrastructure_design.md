# インフラ・デプロイ設計書 (Infrastructure & Deployment Specification)

- **文書ID**: D-08
- **バージョン**: 1.1.0
- **作成日**: 2026-10-21
- **対象環境**: 本番環境 (Node.js ネイティブ実行 / 閉域オンホスト / クラウドマネージド) ※Docker完全非使用

---

## 1. インフラストラクチャ概要

本システムは、医療機関や臨床相談窓口での利用、あるいはセキュアな閉域ネットワーク運用を想定し、**単一サーバー、単一インスタンス（Single Server / Single Instance）での運用を大前提**とします。複雑な分散クラスタ・外部キャッシュ基盤（Redis等）を排除し、**Dockerなどのコンテナ基盤に一切依存しない軽量かつ堅牢なネイティブ実行構成**を採用します。

### パターンA: 閉域オンホスト / オンプレミス（推奨・ゼロ依存構成）
- **実行基盤**: **Docker完全非使用**。Node.js (v20+ / v24+) ネイティブ環境で直接起動（PM2 または systemd によるプロセスデーモン管理）。
- **データベース**: SQLite 3（ローカルファイルDB、WALモード運用）。コンテナや外部DBサーバーのセットアップ不要でゼロ依存稼働。
- **暗号化**: OSレベルのBitLocker / LUKS によるストレージ暗号化（At-Rest）および TLS 1.3 リバースプロキシ（Nginx / Caddy）。
- **ネットワーク**: 院内LAN / 閉域VPN（Tailscale, WireGuard 等）経由でのアクセスに限定し、インターネットからの直接アクセスを遮断。

### パターンB: クラウドマネージド (Google Cloud Platform / VPS)
- **コンピューティング**: Cloud Run または セキュアLinux VPS（Node.js ネイティブサービス直接実行）。
- **データベース**: Cloud SQL for PostgreSQL 16 または ローカルSQLite（Prisma ORMにより透過的互換）。
- **SSL/TLS**: TLS 1.3 強制、マネージドSSL証明書。

---

## 2. システム構成図 (閉域オンホスト / ネイティブ直接実行)

```mermaid
flowchart TD
    Client[PC / スマートフォン (院内LAN / VPN)] -->|HTTPS / TLS 1.3| Proxy[リバースプロキシ (Nginx / Caddy)]
    Proxy -->|HTTP / localhost:3001| NodeApp[Next.js 14 App (Node.js v24+ ネイティブ)]
    NodeApp -->|Prisma ORM (WALモード)| SQLite[(SQLite 3 ファイルDB: prisma/dev.db)]
    SQLite -.->|定期暗号化スナップショット| EncBackup[(暗号化バックアップ領域)]
```

---

## 3. 環境変数 (Environment Variables)

本番環境で設定が必要な環境変数は、`.env` またはシステムサービス定義（systemd / PM2）から注入します。

| 変数名 | 必須 | 設定例 | 説明 |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | ◯ | `production` | 実行環境モード |
| `PORT` | ◯ | `3001` | リッスンポート番号 |
| `DATABASE_URL` | ◯ | `file:./dev.db` | SQLite 接続文字列 (PostgreSQL時は接続URI) |
| `NEXTAUTH_SECRET` | ◯ | (32文字以上の乱数Base64/Hex) | セッションCookie署名鍵 (本番必須) |
| `MFA_ENCRYPTION_KEY` | ◯ | (64文字のHex文字列 / 32バイト) | TOTP秘密鍵の AES-256-GCM 暗号化マスターキー |

---

## 4. デプロイメント手順 (ネイティブ直接起動)

```bash
# 1. 依存関係のインストール (Node.js v20+ / v24+ 環境)
npm ci

# 2. データベースのセットアップ (SQLite / WALモード)
npx prisma db push
node prisma/seed.js

# 3. 本番プロダクションビルド
npm run build

# 4. サーバー起動 (systemd または PM2、または直接起動)
PORT=3001 npm run start
# Windows環境の例: $env:PORT="3001"; npm run start
# Linux/PM2環境の例: pm2 start npm --name "cbt-app" -- start
```

### 4.1 ヘルスチェック
- ヘルスチェックエンドポイント: `GET /api/auth/me`
- レスポンス仕様:
  - 認証済みセッション: HTTP 200 (`{ user: { id, email, role, ... } }`)
  - 未認証時: HTTP 401 (`{ error: '認証が必要です' }`) ※HTTPサーバーおよびNext.jsプロセスの正常稼働・プロセス疎通確認用（※DB接続を含む完全なReadiness確認はDBクエリを伴う認証エンドポイントで実施）
