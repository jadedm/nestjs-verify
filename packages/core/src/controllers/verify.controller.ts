import { Body, Controller, Inject, Ip, NotFoundException, Optional, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VerifyService } from '../verify.service.js';
import { VERIFY_MODULE_OPTIONS } from '../interfaces/module-options.interface.js';
import type { VerifyModuleOptions } from '../interfaces/module-options.interface.js';
import { CheckVerificationDto, StartVerificationDto } from './dto.js';
import { VerifySwagger } from './swagger/verify.swagger.js';

@ApiTags('Verify')
@Controller('verify')
export class VerifyController {
  // `#` fields, so a subclass declaring its own members cannot clash with them.
  readonly #options?: VerifyModuleOptions;

  // Tokens are explicit so injection does not depend on emitted decorator
  // metadata, which some compilers (esbuild, used by vitest) leave out. The
  // options are optional: an app may register this controller in its own
  // module, where VERIFY_MODULE_OPTIONS is not visible.
  constructor(
    @Inject(VerifyService) private readonly verify: VerifyService,
    @Optional()
    @Inject(VERIFY_MODULE_OPTIONS)
    options?: VerifyModuleOptions,
  ) {
    this.#options = options;
  }

  /**
   * With forRootAsync, the controller is registered before the factory runs,
   * so a `registerController: false` returned from the factory cannot keep it
   * out. It is honoured here instead: both routes answer 404 and never reach
   * VerifyService (#18). Global guards and pipes still run before this, so a
   * caller can tell the route exists; only `registerController` on the
   * forRootAsync options removes it entirely.
   */
  #assertMounted(route: 'start' | 'check'): void {
    if (this.#options?.registerController !== false) return;
    throw new NotFoundException(`Cannot POST /verify/${route}`);
  }

  @Post('start')
  @VerifySwagger.start.operation
  @VerifySwagger.start.body
  @VerifySwagger.start.ok
  @VerifySwagger.start.cooldown
  @VerifySwagger.start.rateLimited
  @VerifySwagger.start.invalid
  @VerifySwagger.start.smsFailed
  start(@Body() body: StartVerificationDto, @Ip() ip: string) {
    this.#assertMounted('start');
    return this.verify.start({
      to: body.to,
      channel: body.channel,
      ip,
    });
  }

  @Post('check')
  @VerifySwagger.check.operation
  @VerifySwagger.check.body
  @VerifySwagger.check.ok
  @VerifySwagger.check.noVerification
  @VerifySwagger.check.expired
  check(@Body() body: CheckVerificationDto, @Ip() ip: string) {
    this.#assertMounted('check');
    return this.verify.check({
      to: body.to,
      code: body.code,
      ip,
    });
  }
}
