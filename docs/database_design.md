# データベース詳細設計書 (Database Design Specification)

- **文書ID**: D-05
- **バージョン**: 1.0.0
- **作成日**: 2026-10-16
- **準拠規約**: `AGENTS.md` (Zero Trust Data Isolation, 臨床スコア正規化)

---

## 1. 概要 & 設計方針

本システムは、認知行動療法（CBT）における週間活動記録シートおよび支援者カルテを管理します。
入力されるすべてのデータは**最高水準の要配慮個人情報（メンタルヘルス情報・絶対秘匿）**であり、データモデル設計において以下の原則を厳格に適用しています。

1. **複合ユニーク制約によるデータ同一性担保**: `cbt_activities` において、`[user_id, record_date, hour_slot]` を複合ユニークキーとし、1時間枠の多重登録や競合書き込みを排他します。
2. **スコア正規化と入力履歴スナップショット**: `mood_score` は `0.00 〜 1.00` の正規化FLOAT値として集計の正本とします。後日スタイルや段階数を変更しても過去記録の再現性を維持するため、入力時の選択肢（`mood_raw_level`）と表示記号（`mood_display_symbol`）をスナップショットとして保持します。
3. **未入力・睡眠の `null` 厳格分離**: 未入力や睡眠（活動名のみ記録）スロットには `mood_score: null` を保存し、`0.00`（最悪値）や `0.50`（普通）の偽陽性保存を排斥します。
4. **支援者カルテの完全分離**: `admin_memo` は `admin_member_relations` テーブルにのみ保持し、メンバー向けデータモデル（`cbt_activities`）とは物理的・論理的に分離します。

---

## 2. ER図 (Mermaid)

```mermaid
erDiagram
    User ||--o| UserProfile : "1:1"
    User ||--o| MoodConfiguration : "1:1"
    User ||--o{ CbtActivity : "1:N"
    User ||--o{ ActivityTemplate : "1:N"
    User ||--o{ AdminMemberRelation : "担当関係 (Admin/Member)"
    User ||--o{ AuditLog : "1:N (操作主体)"

    User {
        string id PK "cuid / uuid"
        string email UK "メールアドレス"
        string password_hash "Argon2id ハッシュ"
        string role "member | admin | system_admin"
        string status "invited | active | suspended"
        int failed_login_attempts "連続失敗回数"
        datetime locked_until "アカウントロック解除日時"
        boolean mfa_enabled "2段階認証有効化フラグ"
        string mfa_secret "AES-256-GCM暗号化秘密鍵"
        string mfa_recovery_codes "SHA-256ハッシュJSON"
        bigint last_totp_step "リプレイ攻撃防止ステップ"
        int token_version "セッション即時無効化バージョン"
        string reset_token "招待/パスワード設定トークン"
        datetime reset_expires_at "トークン有効期限"
        datetime created_at
        datetime updated_at
    }

    UserProfile {
        string user_id PK, FK "User ID"
        string display_name "氏名 / 表示名"
        string avatar_color "アバター配色"
        datetime created_at
        datetime updated_at
    }

    MoodConfiguration {
        string user_id PK, FK "User ID"
        string emotion_label "対象感情名 (気分の良さ等)"
        string style_type "weather | face | pawapuro | arrow | number"
        int scale_steps "段階数 (3〜11段階)"
        datetime created_at
        datetime updated_at
    }

    CbtActivity {
        string id PK
        string user_id FK "インデックス・強制バインド"
        date record_date "記録日 (YYYY-MM-DD UTC)"
        int hour_slot "時間枠 (0〜23)"
        string activity_name "活動内容"
        float mood_score "正規化スコア (0.00〜1.00 / NULL可)"
        int mood_raw_level "入力時段階 (1〜N / NULL可)"
        string mood_display_symbol "入力時表示記号 (スナップショット)"
        string notes "補足・メモ"
        datetime created_at
        datetime updated_at
    }

    AdminMemberRelation {
        string id PK
        string admin_id FK "管理者User ID"
        string member_id FK "メンバーUser ID"
        string support_status "active | paused | completed"
        boolean is_visible "一覧表示/アーカイブ切替"
        text admin_memo "支援者専用非公開メモ (絶対秘匿カルテ)"
        datetime memo_updated_at "カルテ最終更新日時"
        string memo_updated_by "カルテ最終更新者名"
        datetime created_at
        datetime updated_at
    }

    ActivityTemplate {
        string id PK
        string user_id FK "所有ユーザーID (NULLはプリセット)"
        string name "テンプレート名"
        boolean is_preset "標準プリセットフラグ"
        string template_type "day | week"
        string schedule_data "活動予定データ (JSON文字列)"
        datetime created_at
        datetime updated_at
    }

    AuditLog {
        string id PK
        string actor_id "操作実行者ID"
        string target_user_id "操作対象ユーザーID (任意)"
        string action "LOGIN | VIEW_MEMBER | UPDATE_SLOT 等"
        string ip_address "クライアントIP"
        string user_agent "ブラウザ情報"
        string details "メタデータ (平文PHI出力禁止 JSON)"
        datetime created_at
    }
        jsonb details "メタデータ (平文PHI出力禁止)"
        datetime created_at
    }
```

---

## 3. テーブル詳細定義

### 3.1 `users` (アカウント認証統括)
| カラム名 | 型 | NULL | 初期値 | 制約 / 説明 |
| :--- | :--- | :---: | :---: | :--- |
| `id` | VARCHAR(36) | NO | UUID/CUID | PK |
| `email` | VARCHAR(255) | NO | - | UNIQUE, 小文字正規化 |
| `password_hash` | VARCHAR(255) | NO | - | Argon2id 形式ハッシュ |
| `role` | VARCHAR(20) | NO | 'member' | CHECK (`role` IN ('member', 'admin', 'system_admin')) |
| `status` | VARCHAR(20) | NO | 'active' | 'invited' (仮登録), 'active' (運用中), 'suspended' (停止) |
| `failed_login_attempts` | INT | NO | 0 | 連続失敗回数（5回でロック発火） |
| `locked_until` | TIMESTAMP | YES | NULL | ロックアウト終了期限 (15分) |
| `mfa_enabled` | BOOLEAN | NO | FALSE | TOTP 2段階認証フラグ |
| `mfa_secret` | VARCHAR(512) | YES | NULL | AES-256-GCM暗号化（`v1:iv:tag:data`） |
| `mfa_recovery_codes` | TEXT | YES | NULL | リカバリーコードSHA-256ハッシュ配列 (JSON) |
| `last_totp_step` | BIGINT | YES | NULL | TOTPリプレイ攻撃防止用タイムステップ |
| `token_version` | INT | NO | 0 | セッション即時失効管理バージョン |
| `reset_token` | VARCHAR(255) | YES | NULL | 招待/パスワード設定ワンタイムトークン (SHA-256ハッシュ) |
| `reset_expires_at` | TIMESTAMP | YES | NULL | 招待トークン有効期限 (48時間) |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |

### 3.2 `cbt_activities` (週間活動記録スロット)
| カラム名 | 型 | NULL | 初期値 | 制約 / 説明 |
| :--- | :--- | :---: | :---: | :--- |
| `id` | VARCHAR(36) | NO | CUID | PK |
| `user_id` | VARCHAR(36) | NO | - | FK (`users.id`) ON DELETE CASCADE |
| `record_date` | DATE | NO | - | 記録対象日 (UTC 00:00:00基準) |
| `hour_slot` | INT | NO | - | 0〜23 (時間スロット) |
| `activity_name` | VARCHAR(255) | NO | - | 活動内容（原本準拠、未入力枠はレコード非保持または空文字） |
| `mood_score` | DECIMAL(3,2) | YES | NULL | 正規化感情スコア（0.00〜1.00、睡眠・未記録時はNULL） |
| `mood_raw_level` | INT | YES | NULL | 入力時点の選択レベル番号（1〜11） |
| `mood_display_symbol` | VARCHAR(32) | YES | NULL | 入力時点の記号スナップショット（☀️、😊、⬆️ 等） |
| `notes` | TEXT | YES | NULL | 状況・気づきメモ |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |

- **インデックス & 制約**:
  - `@@unique([user_id, record_date, hour_slot])` : 1ユーザー・同日・同一時間枠の重複防止
  - `@@index([user_id, record_date])` : 週間範囲クエリの高速化

### 3.3 `admin_member_relations` (担当関係 & 非公開カルテ)
| カラム名 | 型 | NULL | 初期値 | 制約 / 説明 |
| :--- | :--- | :---: | :---: | :--- |
| `id` | VARCHAR(36) | NO | CUID | PK |
| `admin_id` | VARCHAR(36) | NO | - | FK (`users.id`) |
| `member_id` | VARCHAR(36) | NO | - | FK (`users.id`) |
| `support_status` | VARCHAR(20) | NO | 'active' | CHECK (`active`, `inactive`, `completed`) |
| `is_visible` | BOOLEAN | NO | TRUE | 一覧表示/非表示（アーカイブ）トグル |
| `admin_memo` | TEXT | YES | NULL | **支援者専用カルテ（メンバーへはDALで100%遮断）** |
| `memo_updated_at` | TIMESTAMP | YES | NULL | カルテ最終更新日時 |
| `memo_updated_by` | VARCHAR(100) | YES | NULL | 更新支援者氏名 |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |
| `updated_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | |

- **インデックス & 制約**:
  - `@@unique([admin_id, member_id])` : 担当ペアの一意性
  - `@@index([member_id])` : メンバー側からの担当逆引きクエリ高速化

### 3.4 `audit_logs` (監査証跡)
- **インデックス & 制約**:
  - `@@index([actor_id, created_at])` : アクターごとの監査履歴検索
  - `@@index([action, created_at])` : アクション種別検索

---

## 4. セキュリティ & データ分離設計

1. **アクセス制御の物理的分離**:
   - メンバー用クエリは `cbt_activities` テーブルのみを参照し、`admin_member_relations` を JOIN しない。
   - DAL層（`src/lib/dal/cbt.ts`）において `select` 句に明示的プロパティのみをホワイトリスト指定。
2. **監査ログ (`audit_logs`) への非PII記録**:
   - `details` JSONBには操作メタデータ（`slot: 10`, `status: 'active'`）のみを格納し、患者が入力した具体的な活動内容（`activity_name`）やメモ（`notes`）、カルテ内容（`admin_memo`）は絶対に記録しない。
