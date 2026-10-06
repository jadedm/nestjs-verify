---
"@jadedm/nestjs-verify-twilio": patch
---

The provider now loads in ES module apps. Before, importing it from ESM failed at startup with "Named export 'Twilio' not found", on every supported twilio version, because `twilio` is a CommonJS package. CommonJS apps were not affected.
