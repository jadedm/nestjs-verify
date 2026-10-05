#!/usr/bin/env bash
# Fallback publish for when the release workflow cannot publish (for example,
# trusted publishing not configured for a package). Publishes every
# non-private package whose current version is not on npm yet.
# Usage: scripts/publish-manual.sh --otp <code from your authenticator>
set -euo pipefail
cd "$(dirname "$0")/.."
otp=""
[ "${1:-}" = "--otp" ] && otp="${2:-}"
[ -n "$otp" ] || { echo "usage: scripts/publish-manual.sh --otp <code>"; exit 2; }

pnpm install --frozen-lockfile
pnpm build

for dir in packages/*; do
  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")
  private=$(node -p "!!require('./$dir/package.json').private")
  before=$(npm view "$name" version 2>/dev/null || echo "none")
  if [ "$private" = "true" ] || [ "$before" = "$version" ]; then
    echo "skip    $name $version (npm has $before, private=$private)"
    continue
  fi
  (cd "$dir" && pnpm publish --access public --no-git-checks --otp "$otp")
  after=$(npm view "$name" version 2>/dev/null || echo "none")
  echo "publish $name: npm before $before, after $after"
done
