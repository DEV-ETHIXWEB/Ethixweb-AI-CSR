#!/bin/bash
# EC2 user-data for a fresh CSR single server (Amazon Linux 2023, x86_64).
# Runs once at first boot. Installs Docker + Compose + Buildx, adds 2 GB swap
# and creates /opt/ethixweb for the code. Holds no secrets: the env files are
# copied in afterwards by migrate-to-oregon.sh.
set -euxo pipefail
exec > /var/log/ethixweb-bootstrap.log 2>&1

dnf -y update
dnf -y install docker git rsync postgresql16
systemctl enable --now docker
usermod -aG docker ec2-user

# Compose and Buildx plugins (AL2023's docker package ships neither).
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \
  https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-buildx \
  https://github.com/docker/buildx/releases/download/v0.17.1/buildx-v0.17.1.linux-amd64
chmod 755 /usr/local/lib/docker/cli-plugins/*

# 2 GB swap so image builds do not run out of memory on 4 GB.
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Same time zone as the Sydney box kept: UTC.
timedatectl set-timezone UTC

mkdir -p /opt/ethixweb/src /opt/ethixweb/backups
chown -R ec2-user:ec2-user /opt/ethixweb
chmod 700 /opt/ethixweb/backups

touch /var/log/ethixweb-bootstrap.done
