import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerifyModule } from './verify.module.js';
import { VerifyService } from './verify.service.js';
import { VerifyController } from './controllers/verify.controller.js';
import { createMemoryStores } from './store/create-memory-stores.js';
import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { SmsProvider } from './interfaces/sms-provider.interface.js';

const sms: SmsProvider = {
  name: 'stub',
  send: async () => ({ providerMessageId: 'm-1', provider: 'stub' }),
};
const options = (extra: Partial<VerifyModuleOptions> = {}): VerifyModuleOptions => ({
  sms: { provider: sms },
  stores: createMemoryStores(),
  code: { fixedCode: '424242' },
  ...extra,
});

const boot = (module: ReturnType<typeof VerifyModule.forRootAsync>) =>
  NestFactory.createApplicationContext(module, { logger: false });

describe('VerifyModule controller registration (#18)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts no controller when forRootAsync says registerController: false (case 1)', () => {
    const mod = VerifyModule.forRootAsync({ registerController: false, useFactory: () => options() });
    expect(mod.controllers).toEqual([]);
  });

  it('mounts the controller by default with forRootAsync (case 2)', () => {
    const mod = VerifyModule.forRootAsync({ useFactory: () => options() });
    expect(mod.controllers).toEqual([VerifyController]);
  });

  it('leaves forRoot unchanged (case 3)', () => {
    expect(VerifyModule.forRoot(options({ registerController: false })).controllers).toEqual([]);
    expect(VerifyModule.forRoot(options()).controllers).toEqual([VerifyController]);
  });

  it('logs an error when the factory asks for no controller but one is mounted (case 4)', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const app = await boot(VerifyModule.forRootAsync({ useFactory: () => options({ registerController: false }) }));
    await app.close();
    const messages = error.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Set registerController on the forRootAsync options'))).toBe(true);
  });

  it('stays quiet when the async options and the factory agree (case 5)', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const app = await boot(
      VerifyModule.forRootAsync({ registerController: false, useFactory: () => options({ registerController: false }) }),
    );
    await app.close();
    expect(error.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('registerController'))).toEqual([]);
  });

  it('still provides a working VerifyService with the controller off (case 6)', async () => {
    const app = await boot(VerifyModule.forRootAsync({ registerController: false, useFactory: () => options() }));
    const service = app.get(VerifyService);
    const started = await service.start({ to: '+14155552671' });
    expect(started.state).toBe('pending');
    expect((await service.check({ to: '+14155552671', code: '424242' })).state).toBe('approved');
    await app.close();
  });
});
