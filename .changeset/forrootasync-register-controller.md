---
"@jadedm/nestjs-verify": patch
---

`VerifyModule.forRootAsync` accepts `registerController`. Before, the option existed only on the module options returned by `useFactory`, where it was ignored, because the controller list is fixed before the factory runs: an app that wrapped sign-in in its own routes still exposed `POST /verify/start` and `POST /verify/check`, so anyone could start or check a verification directly. Set `registerController: false` on the `forRootAsync` options to leave them unmounted. A `registerController: false` returned from `useFactory` is now honoured too: the controller is still registered, but both routes answer 404 (the same body as a missing route), and startup logs an error saying where to move the setting. The 404 holds even when the log is not seen, for example with `logger: false` or a request-scoped dependency in `inject`.
