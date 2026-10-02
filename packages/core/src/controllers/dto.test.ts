import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckVerificationDto, StartVerificationDto } from './dto.js';

// What Nest's ValidationPipe runs before the controller is reached.
const errorsFor = async <T extends object>(cls: new () => T, body: object) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('request validation (case 16)', () => {
  it.each([
    ['an email start', StartVerificationDto, { to: 'admin@example.com', channel: 'email' }],
    ['a phone start', StartVerificationDto, { to: '+14155552671' }],
    ['an email check', CheckVerificationDto, { to: 'admin@example.com', code: '123456' }],
  ] as const)('accepts %s', async (_l, cls, body) => {
    expect(await errorsFor(cls, body)).toEqual([]);
  });

  it.each([
    ['a malformed recipient', { to: 'nobody' }],
    ['a 255-character email', { to: `${'a'.repeat(243)}@example.com` }],
    ['an unknown channel', { to: 'a@example.com', channel: 'pigeon' }],
  ])('rejects %s', async (_l, body) => {
    expect((await errorsFor(StartVerificationDto, body)).length).toBeGreaterThan(0);
  });
});
