import type {
  EmailProvider,
  EmailSendParams,
  EmailSendResult,
} from '@jadedm/nestjs-verify';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

export interface SesEmailProviderOptions {
  /** Verified SES identity to send from, e.g. 'no-reply@example.com' or 'Example <no-reply@example.com>'. */
  from: string;
  /** Region of the SES identity, e.g. 'ap-south-1'. Ignored when `client` is given. */
  region?: string;
  /** A configured client, for custom credentials or endpoints. */
  client?: SESv2Client;
  /** Optional SES configuration set, for event publishing. */
  configurationSetName?: string;
}

/**
 * Sends verification codes through Amazon SES (API v2). Credentials come from
 * the AWS SDK's default chain unless a client is passed. The SDK retries
 * throttling and server errors itself; anything it gives up on is thrown, so
 * the core can try a fallback provider.
 */
export class SesEmailProvider implements EmailProvider {
  readonly name = 'ses';
  private readonly client: SESv2Client;

  constructor(private readonly opts: SesEmailProviderOptions) {
    this.client = opts.client ?? new SESv2Client({ region: opts.region });
  }

  // The options type is written out rather than imported, so these
  // declarations still type-check against a core version that lacks it.
  async send(params: EmailSendParams, options?: { signal?: AbortSignal }): Promise<EmailSendResult> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.opts.from,
        Destination: { ToAddresses: [params.to] },
        Content: {
          Simple: {
            Subject: { Data: params.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: params.text, Charset: 'UTF-8' } },
          },
        },
        ConfigurationSetName: this.opts.configurationSetName,
      }),
      { abortSignal: options?.signal },
    );
    if (!result.MessageId) throw new Error('SES returned no MessageId');
    return { providerMessageId: result.MessageId, provider: this.name };
  }
}
