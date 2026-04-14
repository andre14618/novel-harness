#!/bin/bash
# Deploy harness to LXC 307. Syncs code, installs deps, runs migrations, restarts service.
# Run after commits to push changes to the runtime environment.
set -e

echo "Checking for uncommitted local changes..."
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "WARNING: Uncommitted local changes will be deployed (not in git history)."
  git status --short
  read -p "Continue anyway? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Deploy aborted."
    exit 1
  fi
fi

echo "Checking for active generation processes on LXC..."
ACTIVE=$(ssh novel-harness-lxc "pgrep -af 'bun (scripts/generate-|scripts/score-|scripts/aggregate-|scripts/eval-)' 2>/dev/null | grep -v pgrep || true")
if [ -n "$ACTIVE" ]; then
  echo "WARNING: Active data generation processes detected on LXC:"
  echo "$ACTIVE"
  echo "Deploying while these run may corrupt lora-data/ output files."
  read -p "Continue anyway? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Deploy aborted."
    exit 1
  fi
fi

echo "Syncing harness code to LXC..."
rsync -az --delete \
  --exclude node_modules --exclude .env --exclude 'data/*.db' --exclude output \
  --exclude .git --exclude '.claude' --exclude 'wandb' \
  --exclude 'scripts/lora-data/' \
  . novel-harness-lxc:~/apps/novel-harness/

# Record which commit (or working tree state) is deployed
COMMIT=$(git rev-parse HEAD)
DIRTY=""
if ! git diff --quiet || ! git diff --cached --quiet; then DIRTY="-dirty"; fi
echo "${COMMIT}${DIRTY}" | ssh novel-harness-lxc "cat > ~/apps/novel-harness/.deployed_commit"
echo "Deployed: ${COMMIT}${DIRTY}"

# Ensure psql-harness alias exists
ssh novel-harness-lxc 'grep -q psql-harness ~/.bashrc 2>/dev/null || echo "alias psql-harness=\"psql \\\"\$(grep DATABASE_URL ~/apps/novel-harness/.env | cut -d= -f2-)\\\"\"" >> ~/.bashrc'

echo "Installing dependencies..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun install"

echo "Building React UI..."
ssh novel-harness-lxc "cd ~/apps/novel-harness/ui && ~/.bun/bin/bun install && ~/.bun/bin/bunx vite build"

echo "Running migrations..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun -e 'import { migrate } from \"./src/db/connection\"; await migrate()'"

echo "Restarting orchestrator..."
ssh novel-harness-lxc "sudo systemctl restart novel-harness-orchestrator"

echo "Checking status..."
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator --no-pager -l"
