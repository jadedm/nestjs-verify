import { describe, expect, it } from 'vitest';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { SesEmailProvider } from './ses-email.provider.js';

// A client whose send() records the command and answers from a script, so no
// request leaves the machine.
const fakeClient = (answer: () => Promise<unknown>) => {
  const commands: SendEmailCommand[] = [];
  const client = {
    send: async (command: SendEmailCommand) => {
      commands.push(command);
      return answer();
    },
  } as unknown as SESv2Client;
  return { client, commands };
};

const params = { to: 'admin@example.com', subject: 'Your code', text: 'Your code is 123456.' };

describe('SesEmailProvider (case 13)', () => {
  it('sends one SendEmail with from, to, subject and text, and returns the MessageId', async () => {
    const { client, commands } = fakeClient(async () => ({ MessageId: 'ses-msg-1' }));
    const provider = new SesEmailProvider({ from: 'no-reply@example.com', client, configurationSetName: 'otp' });
    expect(await provider.send(params)).toEqual({ providerMessageId: 'ses-msg-1', provider: 'ses' });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(SendEmailCommand);
    expect(commands[0].input).toEqual({
      FromEmailAddress: 'no-reply@example.com',
      Destination: { ToAddresses: ['admin@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: 'Your code', Charset: 'UTF-8' },
          Body: { Text: { Data: 'Your code is 123456.', Charset: 'UTF-8' } },
        },
      },
      ConfigurationSetName: 'otp',
    });
  });

  it('throws when SES fails, so the core can fall back', async () => {
    const { client } = fakeClient(async () => {
      throw Object.assign(new Error('Email address is not verified.'), { name: 'MessageRejected' });
    });
    const provider = new SesEmailProvider({ from: 'no-reply@example.com', client });
    await expect(provider.send(params)).rejects.toThrow('not verified');
  });

  it('throws when SES answers without a MessageId', async () => {
    const { client } = fakeClient(async () => ({}));
    const provider = new SesEmailProvider({ from: 'no-reply@example.com', client });
    await expect(provider.send(params)).rejects.toThrow('no MessageId');
  });
});
