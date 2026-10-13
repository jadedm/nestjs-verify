# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately, not in a public issue or pull request.

There are two channels:

1. **GitHub Private Vulnerability Reporting.** Go to the [Security tab](https://github.com/jadedm/nestjs-verify/security) of this repository and click "Report a vulnerability." This is the preferred channel.
2. **Email.** Send a message to `jadedmanish@gmail.com` with the subject line starting with `[nestjs-verify security]`.

Include in your report:

* The package and version you tested against.
* A description of the vulnerability and its impact.
* Reproduction steps or a minimal proof-of-concept. A failing test or a curl that triggers the issue is ideal.
* Your suggested fix, if you have one.

You should expect an acknowledgement within 5 business days. If you do not hear back, escalate by emailing again with a follow-up subject line.

## Supported versions

The latest 1.x minor of each package receives security fixes, as a patch or minor release; npm shows the current version (`npm view @jadedm/nestjs-verify version`). The advisory names the first fixed versions. 0.x versions receive no fixes; upgrade to 1.x.

## Published advisories

* [GHSA-2hm7-qvj9-f6xh](https://github.com/jadedm/nestjs-verify/security/advisories/GHSA-2hm7-qvj9-f6xh): `maxAttempts` was not enforced for simultaneous `check` requests. Affects `@jadedm/nestjs-verify` before 0.8.0; fixed in 0.8.0.
* [GHSA-qm9j-mc5v-33p5](https://github.com/jadedm/nestjs-verify/security/advisories/GHSA-qm9j-mc5v-33p5): `check()` reported `approved` for a verification that was no longer pending, without comparing the code. Affects `@jadedm/nestjs-verify` 0.5.0 and earlier; fixed in 0.6.0.

## Disclosure timeline

* Day 0: report received and acknowledged.
* By day 14: assessment shared with reporter.
* By day 30: fix released, advisory published, reporter credited (if they want it).

If a vulnerability is being actively exploited or the fix is high risk, the timeline may compress. In rare cases where coordination with another project is required, it may extend; we will keep you informed.

## Scope

In scope:

* Bugs in any published package of this repository: `@jadedm/nestjs-verify` and its adapters `-twilio`, `-gupshup`, `-ses`, `-postgres`, `-mongo` and `-redis`.
* Documented behavior in the README that is materially insecure.

Out of scope:

* The known gaps listed under "Maturity and limitations" in the core package README (for example the absence of a tamper-evident audit log or of multi-tenant isolation). These are not vulnerabilities; they are known limitations on the roadmap.
* Issues in transitive dependencies that do not affect the library's behavior.
* Issues caused by misconfiguration in the consuming application (for example, exposing the verify endpoint without authentication and being surprised by abuse).

## Bounty

This project does not run a paid bounty program. Reporters who follow this policy will be credited in the published advisory unless they ask to remain anonymous.
