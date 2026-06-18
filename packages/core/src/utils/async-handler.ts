/**
 * Go-style async tuple handler. Resolves the promise into `[data, null]`
 * on success or `[null, error]` on failure. Lets callers avoid try/catch
 * boilerplate for one-shot calls and keeps the happy path linear.
 *
 * @example
 * const [user, err] = await asyncHandler(userService.getUser(id));
 * if (err) return handleError(err);
 * use(user);
 */
export const asyncHandler = <T>(
  promise: Promise<T>,
): Promise<[T, null] | [null, Error]> =>
  promise
    .then((data): [T, null] => [data, null])
    .catch((error: unknown): [null, Error] => [
      null,
      error instanceof Error ? error : new Error(String(error)),
    ]);
