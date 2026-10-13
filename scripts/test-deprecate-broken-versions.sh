#!/usr/bin/env bash
# Checks scripts/deprecate-broken-versions.mjs against a stub npm (#114).
# Nothing reaches the real registry: the stub serves a small registry from a
# state file and records every `npm deprecate` call instead of making it.
#
# Stub registry: twilio 0.4.0 and 0.5.0 and redis 0.5.0 have a `workspace:^`
# core peer and are not deprecated; postgres 0.5.0 has one and is already
# deprecated; core 0.5.0 has no core peer; every 0.6.0 has a real range.
#
# Usage: scripts/test-deprecate-broken-versions.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# npm's own semver, so the stub matches a deprecate range exactly as npm does.
npm_semver="$(dirname "$(dirname "$(readlink -f "$(command -v npm)")")")/node_modules/semver"
[ -f "$npm_semver/package.json" ] || { echo "cannot find npm's semver at $npm_semver" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"

cat > "$work/registry.json" <<'EOF'
{
  "@jadedm/nestjs-verify": { "0.5.0": {}, "0.6.0": {} },
  "@jadedm/nestjs-verify-twilio": { "0.4.0": { "peer": "workspace:^" }, "0.4.1-beta.0": { "peer": ">=0.6.0 <0.7.0" }, "0.5.0": { "peer": "workspace:^" }, "0.6.0": { "peer": ">=0.6.0 <0.7.0" } },
  "@jadedm/nestjs-verify-postgres": { "0.5.0": { "peer": "workspace:^", "deprecated": "old" }, "0.6.0": { "peer": ">=0.6.0 <0.7.0" } },
  "@jadedm/nestjs-verify-redis": { "0.5.0": { "peer": "workspace:^" }, "0.6.0": { "peer": ">=0.6.0 <0.7.0" } },
  "@jadedm/nestjs-verify-mongo": { "0.6.0": { "peer": ">=0.6.0 <0.7.0" } },
  "@jadedm/nestjs-verify-ses": { "0.6.0": { "peer": ">=0.6.0 <0.7.0" } },
  "@jadedm/nestjs-verify-gupshup": { "0.6.0": { "peer": ">=0.6.0 <0.7.0" } }
}
EOF

cat > "$work/bin/npm" <<EOF
#!/usr/bin/env node
// Stub npm. STUB_NOT_SIGNED_IN: whoami fails with E401. STUB_VIEW_FAIL: every
// view fails with E500. STUB_FAIL_ON=<pkg>: deprecating that package fails.
// STUB_NEVER_SHOWS: deprecations are recorded but never show on read-back.
// deprecate marks every version its range satisfies, using npm's semver with
// includePrerelease, as npm does, and logs the versions it matched.
const fs = require('fs');
const semver = require('$npm_semver');
if (process.argv[2] === 'whoami' && process.env.STUB_NOT_SIGNED_IN) { console.error('npm error code E401'); process.exit(1); }
if (process.argv[2] === 'whoami') { console.log('stub-user'); process.exit(0); }
const state = '$work/registry.json';
const reg = JSON.parse(fs.readFileSync(state, 'utf8'));
const [, , cmd, spec, ...rest] = process.argv;
const at = spec.lastIndexOf('@');
const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, undefined];
if (cmd === 'view') {
  if (process.env.STUB_VIEW_FAIL) { console.error('npm error code E500'); process.exit(1); }
  if (!rest.includes('--prefer-online')) { console.error('stub: view without --prefer-online'); process.exit(3); }
  const pkg = reg[name];
  if (!pkg) { console.error('npm error code E404'); process.exit(1); }
  if (!version) { console.log(JSON.stringify(Object.keys(pkg))); process.exit(0); }
  const v = pkg[version];
  const manifest = { name, version };
  if (v.peer) manifest.peerDependencies = { '@jadedm/nestjs-verify': v.peer, twilio: '^5.0.0' };
  if (v.deprecated && !(process.env.STUB_NEVER_SHOWS && v.byStub)) manifest.deprecated = v.deprecated;
  // Named fields, as real npm answers them: only the fields that exist, and a
  // lone one bare rather than in an object.
  const fields = rest.filter((x) => !x.startsWith('--')).filter((f) => f in manifest);
  if (rest.some((x) => !x.startsWith('--'))) {
    console.log(fields.length === 1 ? JSON.stringify(manifest[fields[0]]) : fields.length ? JSON.stringify(Object.fromEntries(fields.map((f) => [f, manifest[f]]))) : '');
    process.exit(0);
  }
  console.log(JSON.stringify(manifest));
  process.exit(0);
}
if (cmd === 'deprecate') {
  const log = '$work/deprecate.log';
  if (process.env.STUB_FAIL_ON === name) { console.error('npm error code EOTP'); process.exit(1); }
  const matched = Object.keys(reg[name]).filter((v) => semver.satisfies(v, version, { includePrerelease: true }));
  fs.appendFileSync(log, JSON.stringify({ args: process.argv.slice(3), matched }) + '\n');
  for (const v of matched) { reg[name][v].deprecated = rest[0]; reg[name][v].byStub = true; }
  fs.writeFileSync(state, JSON.stringify(reg));
  process.exit(0);
}
console.error('stub: unexpected npm ' + process.argv.slice(2).join(' ')); process.exit(3);
EOF
chmod +x "$work/bin/npm"
cp "$work/registry.json" "$work/registry.base.json"

fails=0
run() { # name, expected exit, must match (ERE, may be empty), must not match, then args after --
  local name=$1 want=$2 must=$3 mustnot=$4; shift 4
  cp "$work/registry.base.json" "$work/registry.json"; rm -f "$work/deprecate.log"
  local envs=(); while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  set +e
  out=$(env PATH="$work/bin:$PATH" DEPRECATE_POLL_MS=10 DEPRECATE_WAIT_SECONDS=1 ${envs[@]+"${envs[@]}"} node scripts/deprecate-broken-versions.mjs "$@" 2>&1)
  got=$?
  set -e
  calls=$(cat "$work/deprecate.log" 2>/dev/null || true)
  local ok=1
  [ "$got" = "$want" ] || ok=0
  [ -z "$must" ] || grep -qE "$must" <<<"$out
$calls" || ok=0
  [ -z "$mustnot" ] || ! grep -qE "$mustnot" <<<"$out
$calls" || ok=0
  if [ "$ok" = 1 ]; then echo "ok    $name"; else echo "FAIL  $name (exit $got)"; printf '%s\n%s\n' "$out" "$calls" | tail -8 | sed 's/^/      /'; fails=$((fails + 1)); fi
}
count_calls() { [ -f "$work/deprecate.log" ] && wc -l < "$work/deprecate.log" | tr -d ' ' || echo 0; }

run "1 dry run lists the three, deprecates nothing" 0 "3 to deprecate; rerun with --apply" "" --
[ "$(count_calls)" = 0 ] && echo "ok    1b no deprecate call in a dry run" || { echo "FAIL  1b dry run called deprecate"; fails=$((fails + 1)); }
run "1c lists twilio 0.4.0, twilio 0.5.0 and redis 0.5.0" 0 "would deprecate @jadedm/nestjs-verify-redis@0.5.0" "" --
run "1d not signed in: exit 1 before any write, with npm's error" 1 "npm error code E401" "" STUB_NOT_SIGNED_IN=1 -- --apply
[ "$(count_calls)" = 0 ] && echo "ok    1e no deprecate call when not signed in" || { echo "FAIL  1e"; fails=$((fails + 1)); }
run "2 --apply deprecates all three and reads them back" 0 "3 deprecated in 2 call\(s\) and read back" "" -- --apply
[ "$(count_calls)" = 2 ] && echo "ok    2b one deprecate call per package (2)" || { echo "FAIL  2b expected 2 deprecate calls, got $(count_calls)"; fails=$((fails + 1)); }
run "2c the message names the fix" 0 "Use the latest version" "" -- --apply
run "2d twilio's range matches exactly its two broken versions" 0 '"matched":\["0\.4\.0","0\.5\.0"\]' "" -- --apply
run "3 an already deprecated version is skipped" 0 "done      @jadedm/nestjs-verify-postgres@0.5.0 \\(already deprecated\\)" '"@jadedm/nestjs-verify-postgres@' -- --apply
run "4 real ranges and core's own versions are never listed" 0 "" "deprecate @jadedm/[a-z-]+@(0\.6\.0|0\.4\.1)|nestjs-verify@0\.5\.0" -- --apply
run "5 npm view fails: exit non-zero, nothing deprecated" 1 "E500" "" STUB_VIEW_FAIL=1 -- --apply
[ "$(count_calls)" = 0 ] && echo "ok    5b no deprecate call after a failed view" || { echo "FAIL  5b"; fails=$((fails + 1)); }
run "6 deprecate fails on the 2nd package: names what is done" 1 "Deprecated in this run: @jadedm/nestjs-verify-twilio@0\.4\.0, @jadedm/nestjs-verify-twilio@0\.5\.0$" "" STUB_FAIL_ON=@jadedm/nestjs-verify-redis -- --apply
run "6b and what is left" 1 "Left: @jadedm/nestjs-verify-redis@0\.5\.0$" "" STUB_FAIL_ON=@jadedm/nestjs-verify-redis -- --apply
run "6c fails on the 1st package: never reaches the 2nd" 1 "" '"@jadedm/nestjs-verify-redis@' STUB_FAIL_ON=@jadedm/nestjs-verify-twilio -- --apply
run "7 read-back never shows: exit 1, names them" 1 "does not show these as deprecated" "and read back" STUB_NEVER_SHOWS=1 -- --apply
run "8 unknown option: exit 2" 2 "usage" "" -- --aply
run "8b --otp without a code: exit 2" 2 "usage" "" -- --apply --otp
run "8c --otp is passed to npm deprecate" 0 '"--otp","123456"' "" -- --apply --otp 123456
run "9 logs the signed-in user" 0 "signed in to npm as stub-user" "" -- --apply
run "9b logs per-package counts" 0 "@jadedm/nestjs-verify-twilio: 4 version\(s\) on npm, 2 broken, 0 already deprecated, 2 to do" "" -- --apply
run "9c logs each call before and after" 0 "\[2/2\] @jadedm/nestjs-verify-redis: npm accepted 1 version" "" -- --apply
run "9d logs the result per version" 0 "  @jadedm/nestjs-verify-redis@0\.5\.0: deprecated" "" -- --apply
run "9e logs a version npm does not show" 1 "  @jadedm/nestjs-verify-redis@0\.5\.0: NOT SHOWN" "" STUB_NEVER_SHOWS=1 -- --apply

echo
[ "$fails" = 0 ] && echo "test-deprecate-broken-versions: passed" || { echo "test-deprecate-broken-versions: $fails failed"; exit 1; }
