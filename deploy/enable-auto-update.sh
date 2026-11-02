#!/usr/bin/env bash
# Turn /opt/science-tokyo-lms-discord-bot into a git checkout owned by lms-bot-deploy so lms-bot-update.service can update it.
# An existing archive-based directory is kept as /opt/science-tokyo-lms-discord-bot.before-git-<time>.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' 'Run with sudo: sudo bash deploy/enable-auto-update.sh'
  exit 1
fi
app=/opt/science-tokyo-lms-discord-bot
repository="${REPOSITORY_URL:-https://github.com/shun1269/isct-LMS-Discord-Bot.git}"
branch="${UPDATE_BRANCH:-main}"
# Reuse the Node.js path already written into the installed unit unless one is given.
node_binary="${NODE_BINARY:-$(sed -n 's|^ExecStart=\(/[^ ]*\) .*|\1|p' /etc/systemd/system/lms-bot.service 2>/dev/null)}"
node_binary="${node_binary:-/usr/bin/node}"
if [[ ! "$node_binary" =~ ^/[A-Za-z0-9_./-]+$ ]] || [ ! -x "$node_binary" ] || [ ! -x "$(dirname "$node_binary")/npm" ]; then
  printf '%s\n' 'Set NODE_BINARY to an absolute Node.js 24 executable with npm next to it.'
  exit 1
fi
if ! command -v git >/dev/null; then
  printf '%s\n' 'Install git first: sudo apt install git'
  exit 1
fi
if ! getent passwd lms-bot-deploy >/dev/null; then
  useradd --system --user-group --home-dir /var/lib/lms-bot-deploy --no-create-home --shell /usr/sbin/nologin lms-bot-deploy
fi
install -d -m 755 -o lms-bot-deploy -g lms-bot-deploy /var/lib/lms-bot-deploy
as_deploy() {
  runuser -u lms-bot-deploy -- env HOME=/var/lib/lms-bot-deploy PATH="$(dirname "$node_binary"):/usr/local/bin:/usr/bin:/bin" "$@"
}

if [ -d "$app/.git" ]; then
  chown -R lms-bot-deploy:lms-bot-deploy "$app"
else
  next="$app.next"
  if [ -e "$next" ]; then
    printf '%s\n' "$next exists from an earlier attempt; remove it first."
    exit 1
  fi
  install -d -m 755 -o lms-bot-deploy -g lms-bot-deploy "$next"
  as_deploy git clone --quiet --branch "$branch" "$repository" "$next"
  (cd "$next" && as_deploy npm ci --no-audit --no-fund && as_deploy npm run typecheck && as_deploy npm test && as_deploy npm run build)
  backup="$app.before-git-$(date +%Y%m%d%H%M%S)"
  mv "$app" "$backup"
  mv "$next" "$app"
  printf 'Previous directory kept at %s\n' "$backup"
fi

NODE_BINARY="$node_binary" bash "$app/deploy/install.sh"
systemctl try-restart lms-bot.service
printf '%s\n' 'After pushing to GitHub, apply it with: sudo systemctl start lms-bot-update.service'
