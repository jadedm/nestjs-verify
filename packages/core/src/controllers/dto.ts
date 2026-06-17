export class StartVerificationDto {
  to!: string;
  channel?: 'sms' | 'voice' | 'email' | 'whatsapp';
}

export class CheckVerificationDto {
  to!: string;
  code!: string;
}
