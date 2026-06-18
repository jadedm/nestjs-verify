import { Body, Controller, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VerifyService } from '../verify.service.js';
import { CheckVerificationDto, StartVerificationDto } from './dto.js';
import { VerifySwagger } from './swagger/verify.swagger.js';

@ApiTags('Verify')
@Controller('verify')
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  @Post('start')
  @VerifySwagger.start.operation
  @VerifySwagger.start.body
  @VerifySwagger.start.ok
  @VerifySwagger.start.cooldown
  @VerifySwagger.start.rateLimited
  @VerifySwagger.start.invalid
  @VerifySwagger.start.smsFailed
  start(@Body() body: StartVerificationDto, @Ip() ip: string) {
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
    return this.verify.check({
      to: body.to,
      code: body.code,
      ip,
    });
  }
}
