import { DynamicModule, Logger, Module, Provider } from '@nestjs/common';
import {
  VERIFY_MODULE_OPTIONS,
  VerifyModuleAsyncOptions,
  VerifyModuleOptions,
} from './interfaces/module-options.interface.js';
import { VerifyService } from './verify.service.js';
import { VerifyController } from './controllers/verify.controller.js';

const CONTROLLER_SETTING_CHECK = Symbol('VERIFY_CONTROLLER_SETTING_CHECK');

/**
 * The controller list is fixed when the module is defined, before an async
 * factory runs, so a `registerController` in the factory's result cannot take
 * effect. When it asks for no controller and one was mounted, say so at
 * startup instead of leaving the routes exposed silently (#18).
 */
const controllerSettingCheck = (mounted: boolean): Provider => ({
  provide: CONTROLLER_SETTING_CHECK,
  inject: [VERIFY_MODULE_OPTIONS],
  useFactory: (options: VerifyModuleOptions) => {
    if (!mounted || options.registerController !== false) return true;
    new Logger('VerifyModule').error(
      'registerController: false was returned from forRootAsync useFactory, where it cannot take effect: ' +
        'POST /verify/start and /verify/check are still mounted. Set registerController on the forRootAsync options instead.',
    );
    return false;
  },
});

@Module({})
export class VerifyModule {
  static forRoot(options: VerifyModuleOptions): DynamicModule {
    return this.build([
      { provide: VERIFY_MODULE_OPTIONS, useValue: options },
    ], options.registerController);
  }

  static forRootAsync(options: VerifyModuleAsyncOptions): DynamicModule {
    const mounted = options.registerController ?? true;
    const provider: Provider = {
      provide: VERIFY_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    return {
      ...this.build(
        [provider, controllerSettingCheck(mounted), ...(options.extraProviders ?? [])],
        mounted,
      ),
      imports: options.imports ?? [],
    };
  }

  private static build(
    providers: Provider[],
    registerController = true,
  ): DynamicModule {
    return {
      module: VerifyModule,
      providers: [...providers, VerifyService],
      controllers: registerController ? [VerifyController] : [],
      exports: [VerifyService],
    };
  }
}
