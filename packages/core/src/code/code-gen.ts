import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export function generateCode(length: number): string {
  if (length < 4 || length > 10) {
    throw new Error(`Invalid OTP length: ${length}. Must be between 4 and 10.`);
  }
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

export function generateSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashCode(code: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${code}`).digest('hex');
}

/**
 * Constant-time string comparison. Both strings are hashed to fixed length
 * before comparison so length differences don't leak through timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function generateSid(): string {
  return `vr_${randomBytes(16).toString('hex')}`;
}
