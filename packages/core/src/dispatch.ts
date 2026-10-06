import type { VerifyModuleOptions } from './interfaces/module-options.interface.js';
import type { DeliveryKind } from './recipient.js';

/** One provider, reduced to what the service needs to send a code. */
export interface Deliverer {
  readonly name: string;
  deliver(to: string, code: string, signal?: AbortSignal): Promise<unknown>;
}

export const DEFAULT_SMS_TEMPLATE =
  'Your verification code is {{code}}. It expires in 10 minutes.';
export const DEFAULT_EMAIL_SUBJECT = 'Your verification code';

const fill = (template: string, code: string) => template.replace('{{code}}', code);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A provider marks an error `mayHaveSent: true` when its request may have
 * been accepted before the failure (a reset after the request left, an HTTP
 * 500, 502 or 504). Only the exact value `true` counts (#33).
 */
export const reportsMayHaveSent = (err: unknown): boolean =>
  (err as { mayHaveSent?: unknown } | null)?.mayHaveSent === true;

// AWS SDK errors carry the request id needed for a support case here.
const requestIdOf = (err: unknown): string | undefined => {
  const id = (err as { $metadata?: { requestId?: unknown } } | null)?.$metadata?.requestId;
  return typeof id === 'string' ? id : undefined;
};

/**
 * Providers often name the recipient in their errors (SES rejections list the
 * address). The error reaches logs, spans and the abuse store, so the
 * recipient is replaced with a placeholder before it leaves the deliverer.
 * Promise.resolve().then() also catches a provider that throws synchronously,
 * which would otherwise skip the scrub.
 */
const scrubbed = async <T>(to: string, send: () => Promise<T>): Promise<T> =>
  Promise.resolve()
    .then(send)
    .catch((err: unknown) => {
      const source = err instanceof Error ? err : new Error(String(err));
      const message = source.message.replace(new RegExp(escapeRegExp(to), 'gi'), '[recipient]');
      const requestId = requestIdOf(err);
      const clean = new Error(requestId ? `${message} (request id ${requestId})` : message);
      clean.name = source.name;
      // The rebuilt error must keep the provider's may-have-sent mark.
      if (reportsMayHaveSent(err)) Object.assign(clean, { mayHaveSent: true });
      throw clean;
    });

const smsDeliverers = (options: VerifyModuleOptions): Deliverer[] => {
  if (!options.sms) return [];
  const body = options.messageTemplate ?? DEFAULT_SMS_TEMPLATE;
  return [options.sms.provider, ...(options.sms.fallbacks ?? [])].map((p) => ({
    name: p.name,
    deliver: (to, code, signal) => scrubbed(to, () => p.send({ to, body: fill(body, code) }, { signal })),
  }));
};

const emailDeliverers = (options: VerifyModuleOptions): Deliverer[] => {
  if (!options.email) return [];
  const { subject = DEFAULT_EMAIL_SUBJECT, template } = options.email;
  const text = template ?? options.messageTemplate ?? DEFAULT_SMS_TEMPLATE;
  return [options.email.provider, ...(options.email.fallbacks ?? [])].map((p) => ({
    name: p.name,
    deliver: (to, code, signal) =>
      scrubbed(to, () =>
        p.send({ to, subject: fill(subject, code), text: fill(text, code) }, { signal }),
      ),
  }));
};

/**
 * Provider chains per delivery kind, primary first. A kind with no providers
 * is absent, so a request for it is refused before any state is touched.
 * Throws when neither SMS nor email is configured.
 */
export const buildDeliverers = (
  options: VerifyModuleOptions,
): Map<DeliveryKind, Deliverer[]> => {
  const chains = new Map<DeliveryKind, Deliverer[]>([
    ['sms', smsDeliverers(options)],
    ['email', emailDeliverers(options)],
  ]);
  for (const [kind, list] of chains) if (list.length === 0) chains.delete(kind);
  if (chains.size === 0) {
    throw new Error('VerifyModule needs at least one of `sms` or `email` configured.');
  }
  return chains;
};
