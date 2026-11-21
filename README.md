# CBT 週間活動記録システム (CBT Activity Record System)

認知行動療法（CBT: Cognitive Behavioral Therapy）における行動活性化法（Behavioral Activation）で用いられる「週間活動記録表」を、PC・タブレット・スマートフォンのマルチデバイスから直感的に記録・管理できるセキュアWebアプリケーションです。

---

## 1. システム概要 & アーキテクチャ原則

- **利用対象者**:
  - **メンバー（クライアント/当事者）**: 日々の活動と気分（感情の推移）を記録し、生活リズムや気分の波を客観視する。
  - **管理者（カウンセラー/医師/サポーター）**: 担当メンバーの記録状況をモニタリングし、伴走支援のための**非公開メモ（カルテ）**を記録する。
- **絶対秘匿の要配慮個人情報保護**:
  - メンバーが記録する活動内容・気分・メモ、管理者の支援メモに至るまで、入力される全データは最高水準の要配慮個人情報（メンタルヘルス情報）として厳格にアクセス分離（Zero Trust DAL）されます。
  - **エクスポート機能は完全非搭載（全廃）**: 端末へのファイル持ち出し・残留リスクを根本的に排除しています。
- **単一サーバー・単一インスタンス運用の大前提**:
  - 分散クラスタや外部セッションストア（Redis等）を不要とし、**Docker完全非使用**。Node.js ネイティブプロセス、ローカル SQLite 3（WALモード）、インメモリ・スライディングウィンドウ・レートリミッターにより、ゼロ依存・超軽量・高耐久な運用を実現しています。

---

## 2. 技術スタック

- **フロントエンド**: Next.js 14+ (App Router), React 18+, Tailwind CSS, Lucide Icons
- **バックエンド**: Next.js Route Handlers / Server Actions, Zod
- **Data Access Layer**: `server-only` DAL による `admin_memo` 秘匿 & IDOR 遮断
- **ORM / DB**: Prisma ORM, SQLite 3 (WALモード)
- **認証 & セキュリティ**:
  - Argon2id パスワードハッシュ (Edgeフォールバック対応)
  - RFC 6238 TOTP 2FA (AES-256-GCM 鍵暗号化 & リプレイ攻撃防止)
  - セッション即時無効化 (Token Versioning)
  - Fetch Metadata (Sec-Fetch-Site) & Same-Origin による CSRF 先制遮断
  - タイミングサイドチャネル遅延均等化 (ユーザー列挙防止)
  - 多層レートリミッター & アカウントロックアウト (423 Locked)

---

## 3. セットアップ & 実行手順

### 必須要件
- Node.js v20+ または v24+
- npm v10+

### インストールと起動
```bash
# 依存パッケージのインストール
npm install

# データベースマイグレーション & クライアント生成
npm run db:push
npm run db:generate

# テスト用初期データの投入 (シード)
npm run db:seed

# 開発サーバーの起動 (ポート 3001)
npm run dev

# 本番ビルド & 起動
npm run build
npm run start
```

ブラウザで `http://localhost:3001` にアクセスします。

---

## 4. 自動テスト & セキュリティ監査

```bash
# 回帰・統合テストスイート (全48項目)
npm test

# 実攻撃シミュレーション・ペネトレーションテスト (全21項目)
node test/security-audit.js
```

---

## 5. ライセンス & ガイドライン
- 本プロジェクトのコーディング・臨床整合性原則は `AGENTS.md` および `.coderabbit.yaml` を参照してください。
