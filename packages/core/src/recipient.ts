import {
  ChannelNotSupportedException,
  InvalidEmailException,
  InvalidPhoneException,
} from './errors.js';
import type { VerificationChannel } from './interfaces/verify-store.interface.js';

/** How a code reaches a recipient. Voice and WhatsApp have no sender yet. */
export type DeliveryKind = 'sms' | 'email';

export interface Recipient {
  kind: DeliveryKind;
  /**
   * Store key (`phone` in store interfaces). For email, the whole address
   * lowercased, so case variants of one mailbox share one cooldown, rate
   * limit and pending verification.
   */
  key: string;
  /** Where the code is sent: the address as given, trimmed. */
  address: string;
}

const E164 = /^\+\d{6,15}$/;
// No display-name or quoting characters, so `a<victim@x.com>` cannot reach a
// mailbox under a fresh key.
const EMAIL_PART = '[^\\s@<>()\\[\\],;:"\\\\]+';
const EMAIL = new RegExp(`^${EMAIL_PART}@${EMAIL_PART}\\.${EMAIL_PART}$`);
export const MAX_EMAIL_LENGTH = 254;

const DELIVERY_FOR: Record<VerificationChannel, DeliveryKind | undefined> = {
  sms: 'sms',
  email: 'email',
  voice: undefined,
  whatsapp: undefined,
};

const normalizePhone = (input: string): string => {
  const phone = input.trim().replace(/\s+/g, '');
  if (!E164.test(phone)) throw new InvalidPhoneException();
  return phone;
};

const normalizeEmail = (input: string): string => {
  const email = input.trim();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) throw new InvalidEmailException();
  return email;
};

const recipientOf = (kind: DeliveryKind, to: string): Recipient => {
  if (kind === 'sms') {
    const phone = normalizePhone(to);
    return { kind, key: phone, address: phone };
  }
  const address = normalizeEmail(to);
  return { kind, key: address.toLowerCase(), address };
};

/**
 * Resolves the recipient for a new verification. Throws before any state is
 * touched when the channel has no configured sender or `to` does not fit it.
 */
export const recipientFor = (
  to: string,
  channel: VerificationChannel,
  configured: ReadonlySet<DeliveryKind>,
): Recipient => {
  const kind = DELIVERY_FOR[channel];
  if (!kind || !configured.has(kind)) throw new ChannelNotSupportedException(channel);
  return recipientOf(kind, to);
};

/** On check the channel is not sent, so the kind comes from the address. */
export const recipientFromAddress = (to: string): Recipient => {
  return recipientOf(to.includes('@') ? 'email' : 'sms', to);
};

export const redact = (key: string): string => {
  const at = key.lastIndexOf('@');
  if (at > 0) return `${key[0]}***${key.slice(at)}`;
  return key.slice(0, 4) + '***' + key.slice(-2);
};
