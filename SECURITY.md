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

This project is pre-1.0. Only the latest minor release is supported for security fixes.

| Version | Supported |
|---|---|
| 0.2.x | yes |
| 0.1.x | no, please upgrade to 0.2.x |

When a 1.0.0 release is cut, this policy will be revisited to add a longer support window for the most recent major version.

## Disclosure timeline

* Day 0: report received and acknowledged.
* By day 14: assessment shared with reporter.
* By day 30: fix released, advisory published, reporter credited (if they want it).

If a vulnerability is being actively exploited or the fix is high risk, the timeline may compress. In rare cases where coordination with another project is required, it may extend; we will keep you informed.

## Scope

In scope:

* Bugs in the published `@jadedm/nestjs-verify`, `@jadedm/nestjs-verify-twilio`, `@jadedm/nestjs-verify-postgres`, and `@jadedm/nestjs-verify-mongo` packages.
* Documented behavior in the README that is materially insecure.

Out of scope:

* The maturity gaps already listed in the README (atomic rate limit accuracy under high concurrency, lack of OpenTelemetry, lack of tamper-evident audit log, and the other items in the "Maturity and limitations" section). These are not vulnerabilities. They are known limitations and live on the 1.0 roadmap.
* Issues in transitive dependencies that do not affect the library's behavior.
* Issues caused by misconfiguration in the consuming application (for example, exposing the verify endpoint without authentication and being surprised by abuse).

## Bounty

This project does not run a paid bounty program. Reporters who follow this policy will be credited in the published advisory unless they ask to remain anonymous.
