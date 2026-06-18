import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

const E164_REGEX = /^\+\d{6,15}$/;

export class StartVerificationDto {
  @ApiProperty({
    description: 'Destination phone number in E.164 format.',
    example: '+14155552671',
  })
  @IsString()
  @Matches(E164_REGEX, {
    message: 'to must be E.164 format, e.g. +14155552671',
  })
  to!: string;

  @ApiPropertyOptional({
    description:
      'Channel to deliver the code through. SMS is the only supported channel today.',
    enum: ['sms', 'voice', 'email', 'whatsapp'],
    default: 'sms',
  })
  @IsOptional()
  @IsIn(['sms', 'voice', 'email', 'whatsapp'])
  channel?: 'sms' | 'voice' | 'email' | 'whatsapp';
}

export class CheckVerificationDto {
  @ApiProperty({
    description: 'Destination phone number in E.164 format.',
    example: '+14155552671',
  })
  @IsString()
  @Matches(E164_REGEX, {
    message: 'to must be E.164 format, e.g. +14155552671',
  })
  to!: string;

  @ApiProperty({
    description: 'The OTP code the user entered.',
    example: '123456',
    minLength: 4,
    maxLength: 10,
  })
  @IsString()
  @Length(4, 10)
  code!: string;
}
