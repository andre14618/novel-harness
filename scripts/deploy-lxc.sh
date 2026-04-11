#!/bin/bash
# Deploy harness to LXC 307. Syncs code, installs deps, runs migrations, restarts service.
# Run after commits to push changes to the runtime environment.
set -e

echo "Syncing harness code to LXC..."
rsync -az --delete \
  --exclude node_modules --exclude .env --exclude 'data/*.db' --exclude output \
  --exclude .git --exclude '.claude' --exclude 'wandb' \
  . novel-harness-lxc:~/apps/novel-harness/

# Ensure psql-harness alias exists
ssh novel-harness-lxc 'grep -q psql-harness ~/.bashrc 2>/dev/null || echo "alias psql-harness=\"psql \\\"\$(grep DATABASE_URL ~/apps/novel-harness/.env | cut -d= -f2-)\\\"\"" >> ~/.bashrc'

echo "Installing dependencies..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun install"

echo "Building React UI..."
ssh novel-harness-lxc "cd ~/apps/novel-harness/ui && ~/.bun/bin/bun install && ~/.bun/bin/bunx vite build"

echo "Running migrations..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun -e 'import { migrate } from \"./data/connection\"; await migrate()'"

echo "Restarting orchestrator..."
ssh novel-harness-lxc "sudo systemctl restart novel-harness-orchestrator"

echo "Checking status..."
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator --no-pager -l"
