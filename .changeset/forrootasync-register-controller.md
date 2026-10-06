---
"@jadedm/nestjs-verify": patch
---

`VerifyModule.forRootAsync` accepts `registerController`. Before, the option existed only on the module options returned by `useFactory`, where it was ignored, because the controller list is fixed before the factory runs: an app that wrapped sign-in in its own routes still exposed `POST /verify/start` and `POST /verify/check`, so anyone could start or check a verification directly. Set `registerController: false` on the `forRootAsync` options to leave them unmounted. A `registerController: false` still returned from `useFactory` now logs an error at startup saying where to move it.
