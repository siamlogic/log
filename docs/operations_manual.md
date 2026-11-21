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
- **期待レスポンス**: 未認証時 HTTP 401 (セッション認証必須APIのため、401応答によりサーバーおよびNext.jsプロセスの正常稼働・Readinessを確認)

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

# 3. バックアップファイルの暗号化保管 (パスフレーズによるAES-256暗号化)
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file /etc/cbt/backup_passphrase.key backups/cbt_backup_${BACKUP_DATE}.db

# 4. 暗号化成功時に平文DBスナップショットを安全消去
if [ -f "backups/cbt_backup_${BACKUP_DATE}.db.gpg" ]; then
  rm -f backups/cbt_backup_${BACKUP_DATE}.db
fi
```

### 2.2 リストア（復旧）手順
```bash
# 1. サービスの安全な停止 (書き込み停止)
pm2 stop cbt-app

# 2. 暗号化バックアップの復号
gpg --batch --yes --decrypt --passphrase-file /etc/cbt/backup_passphrase.key -o backups/restore_temp.db backups/cbt_backup_<DATE>.db.gpg

# 3. 既存DBファイル群の退避 (古いWAL/SHMが残ると復旧データが破損するため一括退避)
mkdir -p prisma/old_db_backup
mv prisma/dev.db prisma/old_db_backup/dev.db.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mv prisma/dev.db-wal prisma/old_db_backup/dev.db-wal.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true
mv prisma/dev.db-shm prisma/old_db_backup/dev.db-shm.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true

# 4. 復号したDBファイルの配置
cp backups/restore_temp.db prisma/dev.db
rm -f backups/restore_temp.db

# 5. DBの整合性検査 (Integrity Check)
sqlite3 prisma/dev.db "PRAGMA integrity_check;"
# 出力が "ok" であることを確認

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
