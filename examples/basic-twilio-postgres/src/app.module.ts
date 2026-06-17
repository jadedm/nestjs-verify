import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { VerifyModule } from '@jadedm/nestjs-verify';
import { TwilioSmsProvider } from '@jadedm/nestjs-verify-twilio';
import {
  PostgresAbuseStore,
  PostgresVerifyStore,
} from '@jadedm/nestjs-verify-postgres';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }),
    VerifyModule.forRootAsync({
      useFactory: async () => {
        const verify = new PostgresVerifyStore({
          connectionString: process.env.DATABASE_URL!,
        });
        const abuse = new PostgresAbuseStore({
          connectionString: process.env.DATABASE_URL!,
        });
        await verify.ensureSchema();
        await abuse.ensureSchema();
        return {
          sms: {
            provider: new TwilioSmsProvider({
              accountSid: process.env.TWILIO_ACCOUNT_SID!,
              authToken: process.env.TWILIO_AUTH_TOKEN!,
              from: process.env.TWILIO_FROM!,
            }),
          },
          stores: { verify, abuse },
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
