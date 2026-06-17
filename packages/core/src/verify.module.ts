import { DynamicModule, Module, Provider } from '@nestjs/common';
import {
  VERIFY_MODULE_OPTIONS,
  VerifyModuleAsyncOptions,
  VerifyModuleOptions,
} from './interfaces/module-options.interface.js';
import { VerifyService } from './verify.service.js';
import { VerifyController } from './controllers/verify.controller.js';

@Module({})
export class VerifyModule {
  static forRoot(options: VerifyModuleOptions): DynamicModule {
    return this.build([
      { provide: VERIFY_MODULE_OPTIONS, useValue: options },
    ], options.registerController);
  }

  static forRootAsync(options: VerifyModuleAsyncOptions): DynamicModule {
    const provider: Provider = {
      provide: VERIFY_MODULE_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };
    return {
      ...this.build([provider, ...(options.extraProviders ?? [])]),
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
