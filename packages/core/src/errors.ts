import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable error codes emitted by VerifyService. The string values are the
 * wire representation: every error response body includes `{ code, message }`,
 * where `code` is one of these.
 *
 * Use on the client side to branch on error kind rather than matching on
 * the message string.
 *
 * @example
 * try { ... } catch (e) {
 *   if (e.response?.data?.code === VerifyErrorCode.CooldownActive) {
 *     // show "wait N seconds" UI
 *   }
 * }
 */
export const VerifyErrorCode = {
  /** Phone fails E.164 validation. HTTP 400. */
  InvalidPhone: 'INVALID_PHONE',
  /** Per-phone cooldown is active. HTTP 429. Response includes retryAfterMs. */
  CooldownActive: 'COOLDOWN_ACTIVE',
  /** Too many sends for this phone in the current window. HTTP 429. */
  PhoneRateLimited: 'PHONE_RATE_LIMITED',
  /** Too many sends from this IP. HTTP 429. */
  IpRateLimited: 'IP_RATE_LIMITED',
  /** IP is touching too many distinct phones (velocity heuristic). HTTP 429. */
  AbuseVelocity: 'ABUSE_VELOCITY',
  /** All configured SMS providers failed. HTTP 503. */
  SmsDispatchFailed: 'SMS_DISPATCH_FAILED',
  /** No active verification for this phone (on check). HTTP 400. */
  NoPendingVerification: 'NO_PENDING_VERIFICATION',
  /** Verification expired before check. HTTP 400. */
  CodeExpired: 'CODE_EXPIRED',
} as const;

export type VerifyErrorCode =
  (typeof VerifyErrorCode)[keyof typeof VerifyErrorCode];

export interface VerifyErrorPayload {
  code: VerifyErrorCode;
  message: string;
  /** Present on `COOLDOWN_ACTIVE`. Milliseconds the client should wait. */
  retryAfterMs?: number;
  /** Present on rate-limit errors. Unix milliseconds at which the window resets. */
  resetAt?: number;
}

/**
 * Base class for every error thrown by VerifyService. Carries the stable
 * error code and any structured details. Catch this to handle all verify
 * errors uniformly in a global exception filter.
 */
export class VerifyException extends HttpException {
  constructor(
    public readonly code: VerifyErrorCode,
    message: string,
    status: HttpStatus,
    public readonly extras: Pick<VerifyErrorPayload, 'retryAfterMs' | 'resetAt'> = {},
  ) {
    super({ code, message, ...extras }, status);
  }
}

export class InvalidPhoneException extends VerifyException {
  constructor() {
    super(
      VerifyErrorCode.InvalidPhone,
      'Phone must be E.164 format, e.g. +14155552671.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class CooldownActiveException extends VerifyException {
  constructor(retryAfterMs: number) {
    super(
      VerifyErrorCode.CooldownActive,
      'A code was sent recently. Please wait before requesting another.',
      HttpStatus.TOO_MANY_REQUESTS,
      { retryAfterMs },
    );
  }
}

export class PhoneRateLimitedException extends VerifyException {
  constructor(resetAt: number) {
    super(
      VerifyErrorCode.PhoneRateLimited,
      'Too many verification requests for this number.',
      HttpStatus.TOO_MANY_REQUESTS,
      { resetAt },
    );
  }
}

export class IpRateLimitedException extends VerifyException {
  constructor(resetAt: number) {
    super(
      VerifyErrorCode.IpRateLimited,
      'Too many verification requests from this network.',
      HttpStatus.TOO_MANY_REQUESTS,
      { resetAt },
    );
  }
}

export class AbuseVelocityException extends VerifyException {
  constructor() {
    super(
      VerifyErrorCode.AbuseVelocity,
      'Suspicious request pattern detected.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export class SmsDispatchFailedException extends VerifyException {
  constructor() {
    super(
      VerifyErrorCode.SmsDispatchFailed,
      'Unable to dispatch verification code. Please try again.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class NoPendingVerificationException extends VerifyException {
  constructor() {
    super(
      VerifyErrorCode.NoPendingVerification,
      'No active verification for this number.',
      HttpStatus.BAD_REQUEST,
    );
  }
}

export class CodeExpiredException extends VerifyException {
  constructor() {
    super(
      VerifyErrorCode.CodeExpired,
      'The code has expired. Request a new one.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
