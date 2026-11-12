#!/usr/bin/env bash
# Bash sample for Treelights tests.
set -euo pipefail
readonly OUT_DIR="${HOME}/scans"
hosts=(10.0.0.1 10.0.0.2)

scan() {
  local host="$1"
  nmap -sV -p 22,80 "$host" > "$OUT_DIR/scan-$host.txt" 2>&1 || echo "failed: $host" >&2
}

mkdir -p "$OUT_DIR"
for host in "${hosts[@]}"; do
  if [[ -n "$host" && "$host" != "skip" ]]; then
    scan "$host" &
  fi
done
wait
count=$(ls "$OUT_DIR" | wc -l)
echo "done: ${count} files" | tee -a log.txt
case "$1" in start) echo start ;; *) exit 1 ;; esac
