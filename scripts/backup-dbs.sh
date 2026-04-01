#!/bin/bash
# Safely backup SQLite databases using .backup command
# (handles WAL mode correctly, unlike raw file copy)
#
# Called by pre-commit hook. Also runnable manually:
#   ./scripts/backup-dbs.sh

set -e

BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
MAX_BACKUPS=20  # keep last N backups per DB

mkdir -p "$BACKUP_DIR"

backup_db() {
  local db_path="$1"
  local db_name="$2"

  if [ ! -f "$db_path" ]; then
    return
  fi

  local dest="$BACKUP_DIR/${db_name}-${TIMESTAMP}.db"
  sqlite3 "$db_path" ".backup '$dest'"
  echo "  backed up: $db_name → $dest ($(du -h "$dest" | cut -f1))"

  # Prune old backups, keep last N
  ls -t "$BACKUP_DIR"/${db_name}-*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null || true
}

backup_db "data/harness.db" "harness"

# Backup any novel DBs that exist
for novel_db in output/novel-*/novel.db; do
  if [ -f "$novel_db" ]; then
    novel_id=$(echo "$novel_db" | sed 's|output/||;s|/novel.db||')
    backup_db "$novel_db" "$novel_id"
  fi
done
