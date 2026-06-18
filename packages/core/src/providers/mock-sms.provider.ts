import { Logger } from '@nestjs/common';
import type {
  SmsProvider,
  SmsSendParams,
  SmsSendResult,
} from '../interfaces/sms-provider.interface.js';

export interface MockSmsProviderOptions {
  /**
   * Whether to log each "send" via @nestjs/common Logger at WARN level.
   * Default: true.
   */
  logToConsole?: boolean;
  /**
   * Optional hook called with every send — useful in tests for capturing
   * the OTP without scraping logs.
   */
  onSend?: (params: SmsSendParams) => void | Promise<void>;
}

/**
 * Mock SMS provider for development and testing. Does NOT send a real SMS —
 * just logs the body and returns a deterministic id. Pair with
 * `code.fixedCode` in your VerifyModule config for fully predictable OTPs.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly log = new Logger(MockSmsProvider.name);
  private counter = 0;
  private readonly opts: MockSmsProviderOptions;

  constructor(opts: MockSmsProviderOptions = {}) {
    this.opts = { logToConsole: true, ...opts };
  }

  async send(params: SmsSendParams): Promise<SmsSendResult> {
    this.counter++;
    if (this.opts.logToConsole) {
      this.log.warn(
        `[MOCK SMS] to=${this.redact(params.to)} body=${JSON.stringify(params.body)}`,
      );
    }
    await this.opts.onSend?.(params);
    return {
      providerMessageId: `mock_${this.counter}_${Date.now()}`,
      provider: this.name,
    };
  }

  private redact(phone: string): string {
    if (phone.length <= 6) return phone;
    return phone.slice(0, 4) + '***' + phone.slice(-2);
  }
}
