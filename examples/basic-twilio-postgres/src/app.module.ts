import { Module } from '@nestjs/common';
import { VerifyModule } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';
import { createPostgresStores } from '@jadedm/nestjs-verify-postgres';

@Module({
  imports: [
    VerifyModule.forRootAsync({
      useFactory: async () => {
        const stores = await createPostgresStores({
          connectionString: process.env.DATABASE_URL!,
        });
        return {
          sms: {
            provider: new TwilioSmsProvider({
              accountSid: process.env.TWILIO_ACCOUNT_SID!,
              authToken: process.env.TWILIO_AUTH_TOKEN!,
              from: process.env.TWILIO_FROM!,
            }),
          },
          stores,
          code: { length: 6, ttlSeconds: 600 },
          attempts: { max: 5, cooldownSeconds: 30 },
          rateLimit: {
            perPhone: { count: 5, windowSeconds: 3600 },
            perIp: { count: 20, windowSeconds: 3600 },
          },
        };
      },
    }),
  ],
})
export class AppModule {}
