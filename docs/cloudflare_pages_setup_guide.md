# Cloudflare Pages GitHub連携デプロイ 実践手順書

本手順書は、本システム（CBT週間活動記録システム）を **Cloudflare Pages** の無料枠へ GitHub 連携によりデプロイ・公開するためのステップバイステップガイドです。

---

## 1. 「プロジェクト名」の決め方

Cloudflare Pages のプロジェクト名は、公開URLのサブドメイン（`https://<プロジェクト名>.pages.dev`）になります。

### 1.1 命名ルール
- **使用可能文字**: 半角小文字英字（`a-z`）、半角数字（`0-9`）、ハイフン（`-`）
- **文字数**: 1〜58文字（先頭と末尾は英数字）
- **自動入力**: GitHub リポジトリを選択すると、リポジトリ名がデフォルト値として自動補完されます。

### 1.2 おすすめの命名パターン
- **リポジトリ名そのまま**: `cbt-activity-record` → `https://cbt-activity-record.pages.dev`
- **用途・環境を付加**: `cbt-app-test` / `cbt-preview-2026`
- **組織名・サフィックス付加**: `cbt-clinic-tokyo` / `cbt-record-myteam`

### 1.3 他人と名前が重複した場合（先着順エラー）
- `pages.dev` ドメインは世界中の Cloudflare ユーザー全体で共通の一意な名前空間です。
- もし `This project name is already taken` と赤字で警告が出た場合は、末尾に日付や識別番号、独自の英単語を付加してください。
  - 例: `cbt-activity-record-test2026`
- ※後からダッシュボードの **[Custom domains]** から、自身の独自ドメイン（例: `cbt.your-domain.jp`）を無料でいつでも紐付けできます。

---

## 2. デプロイ手順（ステップバイステップ）

### 事前準備
1. GitHub アカウント（本リポジトリが push されていること）
2. Cloudflare アカウント（無料プランで可 / クレジットカード不要）

---

### ステップ 1: GitHub リポジトリへの Push
ローカルの変更がすべて GitHub のリモートリポジトリに push されていることを確認します。

```powershell
# Gitリポジトリで最新コードをコミット＆プッシュ
git status
git add .
git commit -m "feat: ready for cloudflare pages deployment"
git push origin main
```

---

### ステップ 2: Cloudflare Pages プロジェクトの作成
1. [Cloudflare ダッシュボード](https://dash.cloudflare.com/) にログインします。
2. 左側メニューから **[Workers & Pages]** を選択します。
3. **[Create application]** ボタンをクリックし、タブから **[Pages]** を選択します。
4. **[Connect to Git (Git に接続)]** をクリックします。
5. 初回は GitHub アカウントの認可画面が出ますので、本リポジトリへのアクセスを許可します。
6. リポジトリ一覧から本プロジェクトのリポジトリ（例: `cbt-activity-record`）を選択し、**[Begin setup (セットアップを開始)]** をクリックします。

---

### ステップ 3: プロジェクト名 & ビルド設定の入力
表示された設定画面に、以下の通り入力します。

| 項目 | 設定値 | 備考 |
| :--- | :--- | :--- |
| **Project name (プロジェクト名)** | 例: `cbt-activity-record` | お好みの名前（第1章参照） |
| **Production branch** | `main` (または `master`) | デプロイ対象のブランチ |
| **Framework preset** | **`Next.js`** | プリセット一覧から選択 |
| **Build command** | **`npm run build:pages`** | ※本プロジェクト専用スクリプト |
| **Build output directory** | **`.vercel/output/static`** | Cloudflare Pages標準出力先 |

---

### ステップ 4: 環境変数の設定 (重要)
同一画面の下部にある **[Environment variables (環境変数)]** を展開し、以下の4つのキーと値を追加します。

| 変数名 (Variable name) | 値 (Value) の例 | 説明 |
| :--- | :--- | :--- |
| **`NODE_VERSION`** | `20` | Node.js 20系を指定（必須） |
| **`NODE_ENV`** | `production` | プロダクション環境指定（必須） |
| **`NEXTAUTH_SECRET`** | *(32文字以上のランダム文字列)* | セッション署名用シークレットキー |
| **`MFA_ENCRYPTION_KEY`** | *(64文字のHex文字列)* | 2FA秘密鍵暗号化用マスターキー |

> [!TIP]
> **秘密鍵（ランダム文字列）の生成方法**:
> ローカルの PowerShell で以下のコマンドを実行すると、安全なランダム文字列を即座に生成できます。
> ```powershell
> # NEXTAUTH_SECRET 用 (32バイト hex = 64文字)
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> 
> # MFA_ENCRYPTION_KEY 用 (32バイト hex = 64文字)
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

---

### ステップ 5: 保存とデプロイの開始
1. 画面右下の **[Save and Deploy (保存してデプロイ)]** をクリックします。
2. Cloudflare のクラウド環境（Linux コンテナ）上で自動ビルドが始まります。
3. ログが流れ、約 1〜2 分で **`Success: Your site is deployed!`** と表示されます。
4. 画面上に表示された URL（例: `https://cbt-activity-record.pages.dev`）をクリックすると、本番アプリが利用可能になります。

---

### ステップ 6: 互換性フラグの確認 (念のための確認)
デプロイ完了後、初回のみ以下を確認してください。

1. プロジェクト設定の **[Settings]** > **[Functions]** を開きます。
2. **Compatibility flags (互換性フラグ)** に **`nodejs_compat`** が入っていることを確認します（通常は `wrangler.toml` により自動適用されます）。

---

## 3. デプロイ後のテスト・動作確認チェックリスト

公開された `https://<プロジェクト名>.pages.dev` にアクセスし、以下をテストします。

- [ ] **PC / スマートフォン両方での表示確認**:
  - PC: 24時間×7日間の週間マトリクスが表示されること。
  - スマホ: 縦型24時間タイムラインが表示され、片手で日送りできること。
- [ ] **ログイン・初期登録テスト**:
  - 初期シードアカウント、または新規招待・初回PW設定の流れを確認。
- [ ] **スロット入力・就寝一括登録**:
  - 活動内容・気分の入力、就寝タグによる8時間範囲登録が正常に行えること。
- [ ] **セッション保持 & ログアウト**:
  - ログアウト後に戻るボタンを押してもセッションが破棄されていること（`Cache-Control: no-store` 検証）。
