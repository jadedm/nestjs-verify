/** A provider attempt that ran past its `delivery` limit. */
export class DeliveryTimeoutError extends Error {
  override name = 'DeliveryTimeoutError';
}

/**
 * Every provider in the chain failed. `mayHaveSent` is true when at least one
 * attempt timed out, or its provider marked the error `mayHaveSent: true`:
 * that request may still reach the recipient.
 */
export class DeliveryChainError extends Error {
  override name = 'DeliveryChainError';
  constructor(
    message: string,
    readonly mayHaveSent: boolean,
  ) {
    super(message);
  }
}

/**
 * Runs `run` with a signal that is aborted after `ms`, and settles with
 * whichever comes first: the attempt or the deadline. The timer is cleared
 * when the attempt wins. An attempt that settles after the deadline is
 * ignored; `Promise.race` keeps its handler on the attempt, so a late
 * rejection is not reported as unhandled.
 */
export const withDeadline = <T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A synchronous throw from `run` becomes a rejection of the attempt.
  const attempt = new Promise<T>((resolve) => resolve(run(controller.signal)));
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DeliveryTimeoutError(`timed out after ${ms} ms`);
      controller.abort(err);
      reject(err);
    }, ms);
  });
  return Promise.race([attempt, deadline]).finally(() => clearTimeout(timer));
};
