---
"@jadedm/nestjs-verify": patch
---

Metrics work in ES module apps. The optional prom-client peer is loaded with `require()`, which does not exist in an ES module, so with `observability.metrics.enabled: true` an ESM app silently got no metrics and a warning wrongly saying prom-client was not installed. The ESM build now carries a helper that makes a `require` from the package at the moment prom-client is loaded, and the loader tries it before plain `require`. Nothing runs at load, so apps bundled with esbuild or webpack keep working as before. CommonJS apps were not affected. The warning now says "not installed" only when prom-client itself cannot be found, and otherwise reports the actual load error, for example a missing dependency of prom-client.
