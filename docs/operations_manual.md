# システム運用・保守手順書 (Operations Manual)

- **文書ID**: D-11
- **バージョン**: 1.1.0
- **改定日**: 2026-10-21
- **対象読者**: システム管理者、インフラ運用担当者
- **前提**: **単一サーバー、単一インスタンス（Single Server / Single Instance）での運用が大前提**。外部分散クラスタやRedis等を不要とし、**Docker完全非使用**（Node.js ネイティブプロセス・ローカルSQLite/PostgreSQL運用）で単一ノード完結自律運用を行います。

---

## 1. 日常運用業務

### 1.1 プロセス状態の確認
本システムは Node.js ネイティブ環境上で Next.js 本番サーバーが稼働します。
```bash
# PM2 を利用している場合
pm2 status cbt-app
pm2 logs cbt-app --lines 100

# systemd を利用している場合
systemctl status cbt-app
journalctl -u cbt-app -n 100 -f
```

### 1.2 サービスヘルスチェック
外部監視ツールまたは監視スクリプトより、以下のエンドポイントを定期的に疎通確認します。
- **URL**: `http://localhost:3001/api/auth/me`（または `https://<FQDN>/api/auth/me`）
- **期待レスポンス**: 未認証時 HTTP 401 (セッション認証必須APIのため、401応答によりHTTPサーバーおよびNext.jsプロセスの正常稼働・プロセス疎通を確認。※DB接続を含めた完全なReadiness確認を行う場合は、DBクエリを伴う認証配下の疎通を併用)

---

## 2. データベースのバックアップ & リストア手順

### 2.1 日次自動バックアップ (SQLite WALモード)
SQLite 3 では、WALモード（Write-Ahead Logging）で整合性を保ちながらオンラインバックアップを実施可能です。

```bash
# 1. バックアップディレクトリの準備
mkdir -p backups

# 2. SQLite オンラインセーフバックアップ (VACUUM INTO による完全アトミックスナップショット)
BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 prisma/dev.db "VACUUM INTO 'backups/cbt_backup_${BACKUP_DATE}.db'"

# 3. バックアップファイルの暗号化保管と平文削除 (gpgの終了ステータスで成否判定)
if gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /etc/cbt/backup_passphrase.key -o "backups/cbt_backup_${BACKUP_DATE}.db.gpg" "backups/cbt_backup_${BACKUP_DATE}.db"; then
  # 暗号化成功時のみ平文スナップショットを安全消去
  rm -f "backups/cbt_backup_${BACKUP_DATE}.db"
  echo "バックアップ暗号化完了: backups/cbt_backup_${BACKUP_DATE}.db.gpg"
else
  echo "GPG暗号化に失敗しました。平文スナップショットを保持して異常終了します。" >&2
  exit 1
fi
```

### 2.2 リストア（復旧）手順
```bash
# 1. サービスの安全な停止 (書き込み停止を確認)
pm2 stop cbt-app || { echo "サービス停止に失敗したため中断します"; exit 1; }

# 2. 実行ごとに分離した一時作業ディレクトリで復号
RESTORE_WORK_DIR=$(mktemp -d /tmp/cbt_restore_XXXXXX)
if ! gpg --batch --yes --decrypt --passphrase-file /etc/cbt/backup_passphrase.key -o "${RESTORE_WORK_DIR}/restore.db" backups/cbt_backup_<DATE>.db.gpg; then
  echo "復号に失敗しました。既存DBは変更せず終了します。" >&2
  rm -rf "${RESTORE_WORK_DIR}"
  exit 1
fi

# 3. 復号したDBの整合性検査 (Integrity Check) を事前検証
INTEGRITY=$(sqlite3 "${RESTORE_WORK_DIR}/restore.db" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
  echo "復元DBの整合性検査に失敗しました ($INTEGRITY)。既存DBは保護され変更されません。" >&2
  rm -rf "${RESTORE_WORK_DIR}"
  exit 1
fi

# 4. 事前検証成功後、既存DBファイル群を一括安全退避 (途中失敗時はDBとWALを一組として安全ロールバック)
OLD_BACKUP_DIR="prisma/old_db_backup/$(date +%Y%m%d_%H%M%S)"
mkdir -p "${OLD_BACKUP_DIR}" || { echo "退避先ディレクトリの作成に失敗したため復元を中断します。" >&2; rm -rf "${RESTORE_WORK_DIR}"; exit 1; }

MOVED_FILES=()
MOVE_FAILED=false

for f in prisma/dev.db prisma/dev.db-wal prisma/dev.db-shm; do
  if [ -f "$f" ]; then
    fname=$(basename "$f")
    if mv "$f" "${OLD_BACKUP_DIR}/${fname}"; then
      MOVED_FILES+=("${fname}")
    else
      echo "既存ファイル ${f} の退避に失敗しました。" >&2
      MOVE_FAILED=true
      break
    fi
  fi
done

if [ "$MOVE_FAILED" = true ]; then
  echo "既存DBファイル群の一部退避に失敗したため、DBとWALの分離を防ぐためロールバックを実行します..." >&2
  ROLLBACK_FAILED=false
  for fname in "${MOVED_FILES[@]}"; do
    if ! mv "${OLD_BACKUP_DIR}/${fname}" "prisma/${fname}"; then
      ROLLBACK_FAILED=true
    fi
  done
  if [ "$ROLLBACK_FAILED" = true ]; then
    echo "【重要障害】退避ロールバックに失敗しました。DBとWALが不整合な状態で分離している恐れがあるため、prisma/ と ${OLD_BACKUP_DIR} の両ファイルをそのまま保全し、サービスを再起動せず停止を維持してください。" >&2
  else
    echo "既存DBファイル群を一組として安全にロールバックしました。復元を中断します。" >&2
  fi
  rm -rf "${RESTORE_WORK_DIR}"
  exit 1
fi

# 5. 検証済みDBファイルの配置
if ! cp "${RESTORE_WORK_DIR}/restore.db" prisma/dev.db; then
  echo "DB配置に失敗しました。一時ファイル ${RESTORE_WORK_DIR} を残してサービス再起動を停止します。" >&2
  exit 1
fi
rm -rf "${RESTORE_WORK_DIR}"

# 6. サービスの再起動
pm2 start cbt-app
```

---

## 3. 監査ログ（`audit_logs`）の点検と不正検知

システム管理者は、週1回以下のクエリにより連続ログイン失敗や権限違反の発生状況を確認します。

```sql
-- 過去24時間のログイン失敗・ロックアウト記録の確認
SELECT actor_id, ip_address, action, details, created_at
FROM audit_logs
WHERE action IN ('LOGIN_FAILED', 'ACCOUNT_LOCKED')
  AND created_at >= datetime('now', '-1 day')
ORDER BY created_at DESC;
```

---

## 4. 障害時緊急連絡・切り分けフロー

1. **アクセス不能（HTTP 502 / 504 / Connection Refused）**:
   - アプリプロセスの再起動: `pm2 restart cbt-app`（または `systemctl restart cbt-app`）
   - プロセスエラーログの確認: `pm2 logs cbt-app --err`
2. **データベース接続エラー**:
   - DBファイル権限および空き容量確認: `ls -lh prisma/dev.db`, `df -h`
   - SQLite 整合性検査: `sqlite3 prisma/dev.db "PRAGMA integrity_check;"`
