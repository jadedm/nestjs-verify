import { Body, Controller, Ip, Post } from '@nestjs/common';
import { VerifyService } from '../verify.service.js';
import { CheckVerificationDto, StartVerificationDto } from './dto.js';

@Controller('verify')
export class VerifyController {
  constructor(private readonly verify: VerifyService) {}

  @Post('start')
  start(@Body() body: StartVerificationDto, @Ip() ip: string) {
    return this.verify.start({
      to: body.to,
      channel: body.channel,
      ip,
    });
  }

  @Post('check')
  check(@Body() body: CheckVerificationDto, @Ip() ip: string) {
    return this.verify.check({
      to: body.to,
      code: body.code,
      ip,
    });
  }
}
