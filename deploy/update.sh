#!/usr/bin/env bash
# Fast-forward the server checkout to origin, verify it in a separate worktree, then swap the build in.
# Runs as lms-bot-deploy when lms-bot-update.service is started by hand; marker files ask the unit's privileged post step to restart.
set -euo pipefail

main() {
  local branch="${UPDATE_BRANCH:-main}" state="${STATE_DIRECTORY:?Run through lms-bot-update.service}" markers="${RUNTIME_DIRECTORY:?Run through lms-bot-update.service}"
  local root staging current target changed
  root="$(cd "$(dirname "$0")/.." && pwd)"
  staging="$state/staging"
  cd "$root"

  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    printf '%s\n' 'Tracked files have local changes on the server; skipping update.' >&2
    return 1
  fi
  git fetch --quiet origin "$branch"
  current="$(git rev-parse HEAD)"
  target="$(git rev-parse FETCH_HEAD)"
  if [ "$current" = "$target" ]; then printf 'Already up to date at %s\n' "$current"; return 0; fi
  if ! git merge-base --is-ancestor "$current" "$target"; then
    printf 'origin/%s is not a fast-forward of %s; skipping update.\n' "$branch" "$current" >&2
    return 1
  fi

  printf 'Verifying %s\n' "$target"
  rm -rf "$staging"
  git worktree prune
  git worktree add --detach --quiet "$staging" "$target"
  if ! (cd "$staging" && npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build); then
    git worktree remove --force "$staging"
    printf 'Verification failed for %s; still running %s.\n' "$target" "$current" >&2
    return 1
  fi

  changed="$(git diff --name-only "$current" "$target")"
  git merge --ff-only --quiet "$target"
  # Swap whole directories so the reminder job never sees a half-written build.
  rm -rf dist.old node_modules.old
  [ -d node_modules ] && mv node_modules node_modules.old
  mv "$staging/node_modules" node_modules
  [ -d dist ] && mv dist dist.old
  mv "$staging/dist" dist
  rm -rf dist.old node_modules.old
  git worktree remove --force "$staging"

  if grep -Eq '^(src/|migrations/|package(-lock)?\.json$|tsconfig)' <<<"$changed"; then touch "$markers/restart"; fi
  if grep -qx 'scripts/register-commands.ts' <<<"$changed"; then touch "$markers/register-commands"; fi
  if grep -Eq '^deploy/(systemd/|install\.sh$)' <<<"$changed"; then
    printf '%s\n' 'systemd units changed; apply them with: sudo bash deploy/install.sh' >&2
  fi
  printf 'Updated %s -> %s\n' "$current" "$target"
}

# Defined as a function so bash has parsed everything before git replaces this file.
main "$@"; exit
