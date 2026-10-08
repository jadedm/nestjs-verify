---
"@jadedm/nestjs-verify": patch
---

Metrics work in ES module apps. The optional prom-client peer is loaded with `require()`, which does not exist in an ES module, so with `observability.metrics.enabled: true` an ESM app silently got no metrics and a warning wrongly saying prom-client was not installed. The ESM build now gets a real `require` resolved from the package. CommonJS apps were not affected. The warning now says "not installed" only when prom-client cannot be found, and otherwise reports the actual load error.
