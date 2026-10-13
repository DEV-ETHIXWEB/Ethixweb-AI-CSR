#!/bin/bash
# Runs backup-db.sh every day at 03:00 server time (UTC). Run once with sudo.
set -euo pipefail
cat > /etc/systemd/system/ethixweb-backup.service <<'EOF'
[Unit]
Description=Ethixweb CSR daily Postgres backup

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/ethixweb/src/infra/aws-single-server/backup-db.sh
EOF
cat > /etc/systemd/system/ethixweb-backup.timer <<'EOF'
[Unit]
Description=Ethixweb CSR daily Postgres backup

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ethixweb-backup.timer
