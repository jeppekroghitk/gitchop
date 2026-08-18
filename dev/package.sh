#!/usr/bin/env bash
# Builds the .xpi from a clean staging copy, so only what the browser needs ships.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/gitchop.xpi"
version="$(sed -n 's/.*"version"[^"]*"\([^"]*\)".*/\1/p' "$root/manifest.json" | head -1)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

for item in manifest.json src icons; do
  cp -R "$root/$item" "$stage/"
done

# Editor, OS and tooling leftovers must not reach a reviewer.
find "$stage" -name '.DS_Store' -delete
find "$stage" -name '*.orig' -delete
find "$stage" -name '.claude' -type d -prune -exec rm -rf {} +
find "$stage" -type d -empty -delete

rm -f "$out"
cd "$stage"
zip -r -q -X "$out" .

echo "gitchop $version -> $out"
unzip -l "$out" | tail -1
