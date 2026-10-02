import { Logger } from '@nestjs/common';
import type {
  EmailProvider,
  EmailSendParams,
  EmailSendResult,
} from '../interfaces/email-provider.interface.js';

export interface MockEmailProviderOptions {
  /** Log each "send" via @nestjs/common Logger at WARN level. Default: true. */
  logToConsole?: boolean;
  /** Called with every send; useful in tests for capturing the code. */
  onSend?: (params: EmailSendParams) => void | Promise<void>;
}

/**
 * Mock email provider for development and testing. Sends nothing; logs the
 * subject and body and returns a deterministic id.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock-email';
  private readonly log = new Logger(MockEmailProvider.name);
  private counter = 0;
  private readonly opts: MockEmailProviderOptions;

  constructor(opts: MockEmailProviderOptions = {}) {
    this.opts = { logToConsole: true, ...opts };
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    this.counter++;
    if (this.opts.logToConsole) {
      this.log.warn(
        `[MOCK EMAIL] to=${redactEmail(params.to)} subject=${JSON.stringify(params.subject)} text=${JSON.stringify(params.text)}`,
      );
    }
    await this.opts.onSend?.(params);
    return {
      providerMessageId: `mock_email_${this.counter}_${Date.now()}`,
      provider: this.name,
    };
  }
}

const redactEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
};
