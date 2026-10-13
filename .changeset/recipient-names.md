---
"@jadedm/nestjs-verify": minor
---

Breaking: recipient-neutral names (#8). Fields, options and store methods that held a phone or an email address are renamed from phone to recipient. The old names still work in 0.9 and log a deprecation warning at boot; they are removed in 1.0.

- `VerificationRecord.phone` and `SendAttempt.phone` are now `recipient`. Core writes both names and keeps reading stores that return only `phone`. A custom store written for 0.8 still runs; its TypeScript now needs `recipient`.
- `PhoneIndexStore` is now `RecipientIndexStore`, `stores.phoneIndex` is now `stores.recipientIndex`, and `MemoryPhoneIndexStore` is now `MemoryRecipientIndexStore`. `createMemoryStores()` returns the index under both keys.
- `rateLimit.perPhone` is now `rateLimit.perRecipient`, and `abuse.maxDistinctPhonesPerIp` is now `abuse.maxDistinctRecipientsPerIp`. Setting an old and a new name to different values fails at boot.
- `AbuseStore.countAttemptsByPhone` and `countDistinctPhonesByIp` are now `countAttemptsByRecipient` and `countDistinctRecipientsByIp`. Core calls the new name and falls back to the old one.
- `AuditEvent.phoneRedacted` is now `recipientRedacted`. Core sets both.
- The error code `PHONE_RATE_LIMITED` is now `RECIPIENT_RATE_LIMITED`. Clients that compare the response's `code` to the string `'PHONE_RATE_LIMITED'` must change. `VerifyErrorCode.PhoneRateLimited` and `PhoneRateLimitedException` remain as deprecated aliases that carry the new code.

The span attribute, the metric and the audit outcome that still say phone are renamed in #7. Database tables and columns keep their names.
