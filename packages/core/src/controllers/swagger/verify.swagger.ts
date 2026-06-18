import { ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CheckVerificationDto, StartVerificationDto } from '../dto.js';

export const VerifySwagger = {
  start: {
    operation: ApiOperation({
      summary: 'Start a verification',
      description:
        'Generates a one-time code, stores a salted hash, and dispatches the code through the configured SMS provider. Returns an sid that the caller can keep or discard; subsequent /verify/check calls only need the phone number.',
    }),
    body: ApiBody({ type: StartVerificationDto }),
    ok: ApiResponse({
      status: 201,
      description: 'Verification created and code dispatched.',
      schema: {
        type: 'object',
        properties: {
          sid: { type: 'string', example: 'vr_c5162b1e6f2c95471fc9f94b9cabd11a' },
          state: { type: 'string', enum: ['pending'], example: 'pending' },
          channel: {
            type: 'string',
            enum: ['sms', 'voice', 'email', 'whatsapp'],
          },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
    }),
    cooldown: ApiResponse({
      status: 429,
      description:
        'A code was sent to this phone recently. The retryAfterMs field tells the client how long to wait.',
      schema: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'COOLDOWN_ACTIVE' },
          message: { type: 'string' },
          retryAfterMs: { type: 'integer', example: 4500 },
        },
      },
    }),
    rateLimited: ApiResponse({
      status: 429,
      description: 'Per-phone or per-IP rate limit exceeded.',
    }),
    invalid: ApiResponse({
      status: 400,
      description: 'Validation error. See `code` for the specific failure.',
    }),
    smsFailed: ApiResponse({
      status: 503,
      description: 'All configured SMS providers failed to dispatch the code.',
    }),
  },

  check: {
    operation: ApiOperation({
      summary: 'Check a verification code',
      description:
        'Compares the submitted code to the stored hash in constant time. Approves the verification on first match. Increments the attempt counter on miss, atomically transitioning to canceled on the attempt that hits maxAttempts.',
    }),
    body: ApiBody({ type: CheckVerificationDto }),
    ok: ApiResponse({
      status: 201,
      description: 'Verification was found and processed.',
      schema: {
        type: 'object',
        properties: {
          sid: { type: 'string' },
          state: {
            type: 'string',
            enum: ['approved', 'pending', 'canceled'],
          },
          attemptsRemaining: { type: 'integer', minimum: 0, example: 4 },
        },
      },
    }),
    noVerification: ApiResponse({
      status: 400,
      description:
        'No active verification was found for this phone number (none started, or already terminal).',
    }),
    expired: ApiResponse({
      status: 400,
      description: 'The verification expired before the code was checked.',
    }),
  },
};
