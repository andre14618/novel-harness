#!/bin/bash
# Pull prompt/config changes from LXC back to local machine.
# Run after an improvement cycle completes. Review with `git diff` before committing.
set -e

echo "Syncing prompt changes from novel-harness-lxc..."
rsync -av novel-harness-lxc:~/apps/novel-harness/src/agents/ src/agents/ \
  --include='*/' --include='*-system.md' --include='config.ts' --exclude='*'

echo "Syncing roles.ts..."
rsync -av novel-harness-lxc:~/apps/novel-harness/models/roles.ts models/roles.ts

echo ""
echo "Done. Review changes:"
echo "  git diff"
echo "  git diff --stat"
