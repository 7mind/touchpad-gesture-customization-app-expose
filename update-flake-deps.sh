#!/usr/bin/env bash
# Recompute npmDepsHash in package.nix after package-lock.json changes.
# Run from anywhere — it edits the package.nix next to it.
#
# Equivalent by hand:
#   nix run nixpkgs#prefetch-npm-deps -- package-lock.json   # prints sha256-…
# then paste the hash into package.nix and `nix build .#default` to verify.

set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
nix_file="$script_dir/package.nix"
lock_file="$script_dir/package-lock.json"

[[ -f "$lock_file" ]] || { echo "no package-lock.json next to $0" >&2; exit 1; }

current=$(sed -nE 's/^[[:space:]]*npmDepsHash[[:space:]]*=[[:space:]]*"([^"]+)";.*/\1/p' "$nix_file" | head -n1)
echo "current npmDepsHash: $current"

echo "computing npmDepsHash from package-lock.json..."
new_hash=$(nix run nixpkgs#prefetch-npm-deps -- "$lock_file" 2>/dev/null \
  | grep -oE 'sha256-[A-Za-z0-9+/=]+' | head -n1)

if [[ -z "$new_hash" ]]; then
  echo "could not compute npmDepsHash via prefetch-npm-deps" >&2
  echo "fix manually — see the recipe at the top of this script." >&2
  exit 1
fi

echo "new npmDepsHash:     $new_hash"

if [[ "$current" == "$new_hash" ]]; then
  echo "already up to date"
  exit 0
fi

sed -i -E "s|^([[:space:]]*npmDepsHash[[:space:]]*=[[:space:]]*\")[^\"]+(\";)|\1${new_hash}\2|" "$nix_file"

echo
echo "updated $nix_file"
echo "next: nix build .#default   # verify the build"
