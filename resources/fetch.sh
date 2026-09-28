#!/usr/bin/env bash
# Re-clone reference repos listed in repos.txt into resources/repos/ (shallow).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p repos
grep -v '^#' repos.txt | awk 'NF{print $1}' | while read -r r; do
  if [ "$r" = "earendil-works/pi" ]; then
    d=repos/earendil-works__pi-official-subagent
    [ -d "$d" ] || { tmp=$(mktemp -d); git clone -q --depth 1 --filter=blob:none --sparse https://github.com/$r "$tmp" && (cd "$tmp" && git sparse-checkout set packages/coding-agent/examples/extensions/subagent) && mkdir -p "$d" && cp -r "$tmp"/packages/coding-agent/examples/extensions/subagent/* "$d"/; rm -rf "$tmp"; }
    continue
  fi
  d=repos/${r//\//__}
  [ -d "$d" ] || git clone -q --depth 1 "https://github.com/$r" "$d"
done
echo "done: $(ls repos | wc -l) repos"
