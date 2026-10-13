#!/bin/bash
# Daily Postgres backup on the single server, keeping the last 7 days.
# Installed as a systemd timer by install-backup-timer.sh. The dumps hold
# customer data: they stay in /opt/ethixweb/backups (owner-only) and are
# pulled to a Mac with scp when needed, never committed anywhere.
set -euo pipefail
BACKUP_DIR=/opt/ethixweb/backups
COMPOSE_DIR=/opt/ethixweb/src/infra/aws-single-server
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/ethixweb-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U postgres -d ethixweb --format=custom > "$file.partial"
mv "$file.partial" "$file"
chmod 600 "$file"
find "$BACKUP_DIR" -name 'ethixweb-*.dump' -mtime +7 -delete
