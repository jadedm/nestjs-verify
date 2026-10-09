#!/usr/bin/env bash
# Checks tag-releases.mjs --after-publish against a registry that lists a new
# version late (#111). Every run is --dry-run: nothing is tagged or pushed.
#
# Stubs on PATH:
# - npm replays a snapshot of the real registry, taken at the start, with
#   core's checked-out version hidden from `versions` until call LIST_AT and
#   not `latest` until call LATEST_AT (counted per run, across packages).
# - git and gh pass through to the real tools, but hide core's tag and
#   release for that version, so the dry run sees it as freshly published.
#   KEEP_TAG and KEEP_RELEASE leave the tag or the release visible.
#
# Usage: scripts/test-tag-releases.sh   (needs npm, gh signed in, and origin)
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)

real_npm=$(command -v npm)
real_git=$(command -v git)
real_gh=$(command -v gh)
core=$(node -p "require('./packages/core/package.json').version")
tag="@jadedm/nestjs-verify@${core}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/snap"

# Snapshot every package's registry state once, from the real npm.
for dir in packages/*; do
  [ "$(node -p "!!require('./$dir/package.json').private")" = "true" ] && continue
  name=$(node -p "require('./$dir/package.json').name")
  "$real_npm" view "$name" versions dist-tags --json > "$work/snap/${name//\//_}.json"
done

cat > "$work/bin/npm" <<EOF
#!/usr/bin/env node
const fs = require('fs');
const [, , cmd, name, ...rest] = process.argv;
if (cmd !== 'view') { console.error('npm stub: only view'); process.exit(3); }
if (process.env.STUB_NPM_FAIL) { console.error('npm ERR! code E500 stub failure'); process.exit(1); }
const dir = name === '@jadedm/nestjs-verify' ? 'core' : 'other';
const snap = JSON.parse(fs.readFileSync('$work/snap/' + name.replace('/', '_') + '.json', 'utf8'));
const counter = '$work/calls';
const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(n));
const version = '$core';
if (dir === 'core' && n < Number(process.env.E404_UNTIL || 0)) { console.log('{"error":{"code":"E404"}}'); console.error('npm error code E404'); process.exit(1); }
let versions = [snap.versions].flat().filter((v) => dir !== 'core' || v !== '$core');
if (dir === 'core') {
  if (n >= Number(process.env.LIST_AT || 1)) versions.push(version);
}
const tags = { ...snap['dist-tags'] };
if (dir === 'core' && n < Number(process.env.LATEST_AT || 1)) tags.latest = versions.filter((v) => v !== version).at(-1);
if (dir === 'core' && n >= Number(process.env.LATEST_AT || 1) && !version.includes('-')) tags.latest = version;
const field = rest.filter((a) => !a.startsWith('--'));
// Without --prefer-online npm may answer from its cache: the listing before
// the publish.
const stale = !rest.includes('--prefer-online') || (process.env.STALE_LISTING && field.join() === 'versions')
  || (process.env.STALE_LATEST && field.join() === 'dist-tags.latest');
if (dir === 'core' && stale) { versions = versions.filter((v) => v !== version); tags.latest = versions.at(-1); }
if (field.join() === 'versions,dist-tags') console.log(JSON.stringify({ versions, 'dist-tags': tags }));
else if (field.join() === 'versions') console.log(JSON.stringify(versions));
else if (field.join() === 'dist-tags.latest') console.log(tags.latest);
else { console.error('npm stub: unexpected ' + process.argv.slice(2).join(' ')); process.exit(3); }
EOF

cat > "$work/bin/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "ls-remote" ]; then
  out=\$("$real_git" "\$@") || exit \$?
  [ -n "\${KEEP_TAG:-}" ] && { printf '%s\n' "\$out"; exit 0; }
  printf '%s\n' "\$out" | grep -vE "refs/tags/${tag//./\\.}(\\^\\{\\})?\$"; exit 0
fi
exec "$real_git" "\$@"
EOF

cat > "$work/bin/gh" <<EOF
#!/usr/bin/env bash
if [ "\$1 \$2" = "release list" ] && [ -n "\${KEEP_RELEASE:-}" ]; then exec "$real_gh" "\$@"; fi
if [ "\$1 \$2" = "release list" ]; then "$real_gh" "\$@" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).filter((r)=>r.tagName!=="$tag"))))'; exit 0; fi
exec "$real_gh" "\$@"
EOF
chmod +x "$work/bin/"*

fails=0
run() { # name, expected exit, grep that must match, grep that must not match, env...
  local name=$1 want=$2 must=$3 mustnot=$4; shift 4
  rm -f "$work/calls"
  set +e
  out=$(env PATH="$work/bin:$PATH" TAG_RELEASES_POLL_MS=10 TAG_RELEASES_WAIT_SECONDS=20 "$@" node scripts/tag-releases.mjs --dry-run ${ARGS:-} 2>&1)
  got=$?
  set -e
  local ok=1
  [ "$got" = "$want" ] || ok=0
  [ -z "$must" ] || grep -qE "$must" <<<"$out" || ok=0
  [ -z "$mustnot" ] || ! grep -qE "$mustnot" <<<"$out" || ok=0
  if [ "$ok" = 1 ]; then echo "ok    $name"; else echo "FAIL  $name (exit $got)"; echo "$out" | tail -8 | sed 's/^/      /'; fails=$((fails + 1)); fi
}

ARGS=--after-publish run "1 listed on a later poll: waits, then tags and releases it" 0 \
  "would release  ${tag} \(latest\)" "" LIST_AT=6 LATEST_AT=6
ARGS=--after-publish run "1c and tags it" 0 "would tag      ${tag} at" "" LIST_AT=6 LATEST_AT=6
ARGS=--after-publish run "1b the wait was observed" 0 "waiting for npm: ${tag} \(not listed\)" "" LIST_AT=6 LATEST_AT=6
ARGS=--after-publish run "2 listed but not yet latest: keeps waiting" 0 \
  "waiting for npm: ${tag} \(latest is still" "" LIST_AT=1 LATEST_AT=9
ARGS=--after-publish run "2b then releases it as latest" 0 \
  "would release  ${tag} \(latest\)" "" LIST_AT=1 LATEST_AT=9
ARGS=--after-publish run "3 never listed: exit 1, names it, plans nothing" 1 \
  "npm does not show:.*" "would (tag|release)" LIST_AT=100000 TAG_RELEASES_WAIT_SECONDS=1
ARGS=--after-publish run "3b first publish answers E404 at first: waits, then tags it" 0 \
  "would tag      ${tag} at" "" E404_UNTIL=6 LIST_AT=1 LATEST_AT=1
ARGS= run "5 no --after-publish: no wait, reports what npm lists now" 0 \
  "every published version is tagged and released" "waiting" LIST_AT=100000 LATEST_AT=100000
ARGS=--after-publish run "4 latest moved back on purpose after tag and release: no wait" 0 \
  "" "waiting" KEEP_TAG=1 KEEP_RELEASE=1 LIST_AT=1 LATEST_AT=100000
ARGS=--after-publish run "4b tagged earlier, release missing: still waits for latest" 0 \
  "waiting for npm: ${tag} \(latest is still" "would tag      ${tag}" KEEP_TAG=1 LIST_AT=1 LATEST_AT=9
ARGS=--after-publish run "4c then releases it" 0 \
  "would release  ${tag} \(latest\)" "" KEEP_TAG=1 LIST_AT=1 LATEST_AT=9
ARGS=--after-publish run "8 stale listing in the tagging pass: stops, nothing planned" 1 \
  "did not list it" "would tag      ${tag}" LIST_AT=1 LATEST_AT=1 STALE_LISTING=1
ARGS=--after-publish run "8b stale latest in the release pass: stops" 1 \
  "did not see it as latest" "would release  ${tag}" LIST_AT=1 LATEST_AT=1 STALE_LATEST=1
ARGS=--after-publish run "9 non-numeric poll interval: exit 2, no hang" 2 "must be numbers" "" TAG_RELEASES_POLL_MS=soon
ARGS="--after-publsh" run "6 mistyped option: exit 2" 2 "unknown option" ""
ARGS=--after-publish run "7 npm error: exits non-zero, no wait" 1 "E500" "waiting" STUB_NPM_FAIL=1

echo
[ "$fails" = 0 ] && echo "test-tag-releases: passed" || { echo "test-tag-releases: $fails failed"; exit 1; }
