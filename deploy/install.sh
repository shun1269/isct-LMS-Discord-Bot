#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run with sudo: sudo bash deploy/install.sh'
  exit 1
fi
project_root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$project_root" != /opt/science-tokyo-lms-discord-bot ]; then
  printf '%s\n' 'Place the project in /opt/science-tokyo-lms-discord-bot first.'
  exit 1
fi
node_binary="${NODE_BINARY:-/usr/bin/node}"
if [[ ! "$node_binary" =~ ^/[A-Za-z0-9_./-]+$ ]] || [ ! -x "$node_binary" ]; then
  printf '%s\n' 'Set NODE_BINARY to an absolute Node.js executable path.'
  exit 1
fi
if [ "$("$node_binary" -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  printf '%s\n' 'Install Node.js 24 first.'
  exit 1
fi
if [ ! -x "$(dirname "$node_binary")/npm" ]; then
  printf '%s
' 'npm must be installed next to the Node.js executable.'
  exit 1
fi
test -f "$project_root/dist/src/index.js"
if ! getent passwd lms-bot >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/lms-bot --no-create-home --shell /usr/sbin/nologin lms-bot
fi
install -d -m 700 -o lms-bot -g lms-bot /var/lib/lms-bot
if ! getent passwd lms-bot-deploy >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/lms-bot-deploy --no-create-home --shell /usr/sbin/nologin lms-bot-deploy
fi
install -d -m 755 -o lms-bot-deploy -g lms-bot-deploy /var/lib/lms-bot-deploy
if [ ! -f /etc/lms-bot.env ]; then
  install -m 600 "$project_root/.env.example" /etc/lms-bot.env
  sed -i 's|^DATABASE_PATH=.*|DATABASE_PATH=/var/lib/lms-bot/lms.sqlite|' /etc/lms-bot.env
fi
install -m 644 "$project_root"/deploy/systemd/lms-bot.service /etc/systemd/system/
install -m 644 "$project_root"/deploy/systemd/lms-bot-reminders.service /etc/systemd/system/
install -m 644 "$project_root"/deploy/systemd/lms-bot-reminders.timer /etc/systemd/system/
install -m 644 "$project_root"/deploy/systemd/lms-bot-update.service /etc/systemd/system/
install -m 644 "$project_root"/deploy/systemd/lms-bot-update.timer /etc/systemd/system/
install -m 644 "$project_root"/deploy/systemd/lms-bot-register-commands.service /etc/systemd/system/
sed -i "s|/usr/bin/node|$node_binary|g" /etc/systemd/system/lms-bot.service /etc/systemd/system/lms-bot-reminders.service /etc/systemd/system/lms-bot-register-commands.service
sed -i "s|@NODE_DIR@|$(dirname "$node_binary")|g" /etc/systemd/system/lms-bot-update.service
systemctl daemon-reload
printf '%s\n' 'Installed. Configure /etc/lms-bot.env and import D1 before starting either service.'
printf '%s\n' 'Start API: sudo systemctl enable --now lms-bot.service'
printf '%s\n' 'Enable reminders after Cloudflare Cron is stopped: sudo systemctl enable --now lms-bot-reminders.timer'
