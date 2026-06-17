import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateCode,
  generateSalt,
  hashCode,
} from './code-gen.js';

describe('code-gen', () => {
  it('produces codes of the requested length', () => {
    for (const len of [4, 5, 6, 7, 8]) {
      const code = generateCode(len);
      expect(code).toHaveLength(len);
      expect(/^\d+$/.test(code)).toBe(true);
    }
  });

  it('rejects out-of-range lengths', () => {
    expect(() => generateCode(3)).toThrow();
    expect(() => generateCode(11)).toThrow();
  });

  it('hash is deterministic for same salt+code', () => {
    const salt = generateSalt();
    expect(hashCode('123456', salt)).toBe(hashCode('123456', salt));
  });

  it('hash diverges with different salts', () => {
    const a = hashCode('123456', 'salt-a');
    const b = hashCode('123456', 'salt-b');
    expect(a).not.toBe(b);
  });

  it('constantTimeEqual returns true for equal strings, false otherwise', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
