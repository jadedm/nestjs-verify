/**
 * Fails unless the npm and Node on PATH can publish with npm trusted
 * publishing (OIDC): npm 11.5.1+ and Node 22.14.0+, per
 * https://docs.npmjs.com/trusted-publishers. Older npm answers an OIDC publish
 * with E404, which reads like a missing package rather than a version problem
 * (#19). Run in the release workflow before publishing.
 */
import { execFileSync } from 'node:child_process';

const MIN = { npm: '11.5.1', node: '22.14.0' };

const parse = (v) => v.trim().replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10));
const atLeast = (have, want) => {
  const [a, b] = [parse(have), parse(want)];
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
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
