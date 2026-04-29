#!/bin/bash
# Generate fresh novels for hallucination-checker training data.
# 7 with v4 LoRA (default), 7 with DeepSeek (via WRITER_MODEL_OVERRIDE).
# Logs to /tmp/halluc-novel-<writer>-<seed>.log
#
# Tracking: novel_ids will be timestamp-based. We'll mine by writer model
# in llm_calls (v4 → 'wandb-artifact:///...salvatore-1988-v4',
# deepseek → 'deepseek-v4-flash').

cd ~/apps/novel-harness
set -a; source .env; set +a

V4_SEEDS=(fantasy-healer fantasy-archive fantasy-cartographer fantasy-cultivation-void fantasy-bridge fantasy-debt dark-fantasy)
DS_SEEDS=(fantasy-succession fantasy-inscription fantasy-mana-eating fantasy-siege fantasy-echo-mage fantasy-system-heretic fantasy-class-copy)

START_TS=$(date +%s)
echo "Start timestamp: $START_TS — use this to filter novels later"
echo "$START_TS" > /tmp/halluc-fresh-start-ts

for seed in "${V4_SEEDS[@]}"; do
  log=/tmp/halluc-novel-v4-${seed}.log
  echo "  Launching v4 / $seed → $log"
  ( unset WRITER_MODEL_OVERRIDE WRITER_PROVIDER_OVERRIDE
    nohup bun src/index.ts --auto --seed "$seed" --chapters 5 > "$log" 2>&1 ) &
  sleep 1
done

for seed in "${DS_SEEDS[@]}"; do
  log=/tmp/halluc-novel-ds-${seed}.log
  echo "  Launching deepseek / $seed → $log"
  ( export WRITER_MODEL_OVERRIDE="deepseek-v4-flash" WRITER_PROVIDER_OVERRIDE="deepseek"
    nohup bun src/index.ts --auto --seed "$seed" --chapters 5 > "$log" 2>&1 ) &
  sleep 1
done

echo ""
echo "Launched 14 novels (7 v4 + 7 deepseek). 5 chapters each."
echo "Wait with: while pgrep -af 'bun src/index.ts' >/dev/null; do sleep 30; done; echo done"
