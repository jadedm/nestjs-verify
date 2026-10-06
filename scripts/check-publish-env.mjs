/**
 * Fails unless the npm and Node on PATH can publish with npm trusted
 * publishing (OIDC): npm 11.5.1+ and Node 22.14.0+, per
 * https://docs.npmjs.com/trusted-publishers. Older npm answers an OIDC publish
 * with E404, which reads like a missing package rather than a version problem
 * (#19). Run in the release workflow before publishing.
 */
import { execFileSync } from 'node:child_process';

const MIN = { npm: '11.5.1', node: '22.14.0' };

// A version that is not plain MAJOR.MINOR.PATCH (a pre-release such as
// 11.5.1-pre.1, or anything unparsable) never passes.
const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const atLeast = (have, want) => {
  const a = RELEASE.exec(have.trim());
  const b = RELEASE.exec(want);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i += 1) {
    const [x, y] = [Number(a[i]), Number(b[i])];
    if (x !== y) return x > y;
  }
  return true;
};

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const found = { npm: npmVersion, node: process.versions.node };
const tooOld = Object.keys(MIN).filter((tool) => !atLeast(found[tool], MIN[tool]));

console.log(`npm ${found.npm}, node ${found.node}`);
if (tooOld.length > 0) {
  for (const tool of tooOld) console.error(`${tool} ${found[tool]} is older than ${MIN[tool]}, which trusted publishing needs`);
  process.exit(1);
}
