#!/bin/bash
# Deploy harness to LXC 307. Syncs code, installs deps, runs migrations, restarts service.
# Run after commits to push changes to the runtime environment.
set -e

echo "Syncing harness code to LXC..."
rsync -az --delete \
  --exclude node_modules --exclude .env --exclude 'data/*.db' --exclude output \
  --exclude .git --exclude '.claude' \
  . novel-harness-lxc:~/apps/novel-harness/

echo "Installing dependencies..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun install"

echo "Running migrations..."
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun -e 'import { migrate } from \"./data/connection\"; await migrate()'"

echo "Restarting orchestrator..."
ssh novel-harness-lxc "sudo systemctl restart novel-harness-orchestrator"

echo "Checking status..."
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator --no-pager -l"
