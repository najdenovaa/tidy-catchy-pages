#!/usr/bin/env bash
set -euo pipefail

destination=$1
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
source="https://raw.githubusercontent.com/naptha/tessdata/806cd9adc8c6e8abc11c782db1818c990576bebc/4.0.0_best_int"
for lang in eng rus; do
  curl --fail --silent --show-error --location --retry 2 --max-time 40 \
    "$source/$lang.traineddata.gz" --output "$scratch/$lang.traineddata.gz"
done
(
  cd "$scratch"
  sha256sum --check <<'HASHES'
45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91  eng.traineddata.gz
f51f5edc992249ff9b70a227b22f242dfa47b2b1bbc7ae0ea74908640c101f6a  rus.traineddata.gz
HASHES
)
mkdir -p "$destination"
cp "$scratch"/*.traineddata.gz "$destination/"
printf '%s\n' '{"version":1}' > "$destination/models.json"
