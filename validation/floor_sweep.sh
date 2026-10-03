#!/usr/bin/env bash
# For datasets with no measurable silence: run the engine under several ASSUMED room-noise floors and compare.
#   bash validation/floor_sweep.sh svd validation/data/svd 20 -70 -60 -50
# args: preset root limit-per-group floor1 floor2 ...   (needs the python venv active; run from the repo root)
set -euo pipefail
preset="$1"; root="$2"; limit="$3"; shift 3
mkdir -p validation/out
first=""; last=""
for f in "$@"; do
  m="validation/manifest-$preset-floor$f.json"; o="validation/out/$preset-floor$f.jsonl"
  python validation/make_manifest.py --preset "$preset" --root "$root" --limit-per-group "$limit" --floor-db "$f" --out "$m" > /dev/null
  node validation/run-engine.mjs "$m" --out "$o"
  [ -z "$first" ] && first="$f"; last="$f"
done
mid="${2:-$first}"
echo; echo "######## full report at floor $first dBFS"
python validation/compare.py "validation/manifest-$preset-floor$first.json" "validation/out/$preset-floor$first.jsonl"
if [ "$first" != "$last" ]; then
  echo; echo "######## does the answer change between floor $first and floor $last? (drift section only)"
  python validation/compare.py "validation/manifest-$preset-floor$first.json" "validation/out/$preset-floor$first.jsonl" \
    --vs "validation/out/$preset-floor$last.jsonl" --no-praat | sed -n '/== 3/,/== 4\|== 5/p' | grep -v "== 5"
fi
