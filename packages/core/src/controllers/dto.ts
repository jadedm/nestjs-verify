import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

// An E.164 phone or an email address. Which one a channel accepts is checked
// by VerifyService, which knows the configured providers.
const RECIPIENT_REGEX = /^(\+\d{6,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;
const RECIPIENT_MESSAGE = 'to must be an E.164 phone, e.g. +14155552671, or an email address';

export class StartVerificationDto {
  @ApiProperty({
    description:
      'Destination: an E.164 phone for sms, or an email address for email.',
    example: '+14155552671',
  })
  @IsString()
  @MaxLength(254)
  @Matches(RECIPIENT_REGEX, { message: RECIPIENT_MESSAGE })
  to!: string;

  @ApiPropertyOptional({
    description:
      'Channel to deliver the code through: sms (default) or email, when configured. voice and whatsapp are rejected until they have providers.',
    enum: ['sms', 'voice', 'email', 'whatsapp'],
    default: 'sms',
  })
  @IsOptional()
  @IsIn(['sms', 'voice', 'email', 'whatsapp'])
  channel?: 'sms' | 'voice' | 'email' | 'whatsapp';
}

export class CheckVerificationDto {
  @ApiProperty({
    description:
      'Destination: an E.164 phone for sms, or an email address for email.',
    example: '+14155552671',
  })
  @IsString()
  @MaxLength(254)
  @Matches(RECIPIENT_REGEX, { message: RECIPIENT_MESSAGE })
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
