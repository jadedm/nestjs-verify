#!/usr/bin/env bash
# Fallback publish for when the release workflow cannot publish (for example,
# trusted publishing not configured for a package). Publishes every
# non-private package whose current version is not on npm yet.
#
# Run from your own terminal after `npm login`. npm then asks for 2FA as a
# browser approval ("Authenticate your account at: ..."). That prompt needs a
# terminal; without one, only a valid --otp code can pass 2FA.
#
# Usage: scripts/publish-manual.sh [--otp <code>]
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "usage: scripts/publish-manual.sh [--otp <code>]"; exit 2; }

otp_args=()
[ $# -le 2 ] || usage
case "${1:-}" in
  "") ;;
  --otp) [ -n "${2:-}" ] || usage; otp_args=(--otp "$2") ;;
  *) usage ;;
esac

npm whoami >/dev/null 2>&1 || { echo "npm whoami failed: not logged in (run 'npm login') or registry unreachable"; exit 1; }

# True when this exact version is on npm. Any error other than a 404 stops the
# script, so a registry failure is never read as "not published".
published() {
  local out
  out=$(npm view "$1@$2" version 2>&1) && { [ "$out" = "$2" ]; return; }
  case "$out" in *E404*) return 1 ;; esac
  echo "npm view $1@$2 failed: $out" >&2
  exit 1
}

pnpm install --frozen-lockfile
pnpm build

for dir in packages/*; do
  name=$(node -p "require('./$dir/package.json').name")
  version=$(node -p "require('./$dir/package.json').version")
  private=$(node -p "!!require('./$dir/package.json').private")
  if [ "$private" = "true" ]; then
    echo "skip    $name $version (private)"
    continue
  fi
  if published "$name" "$version"; then
    echo "skip    $name $version (already on npm)"
    continue
  fi
  # bash 3.2 (macOS) treats an empty array as unbound under set -u.
  (cd "$dir" && pnpm publish --access public --no-git-checks ${otp_args[@]+"${otp_args[@]}"})
  echo "published $name@$version"
done
