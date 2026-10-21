/** A failure a browser names, as a library tells one from another: by its name. */
export function domError(message: string, name: string): Error {
  const Named = (globalThis as { DOMException?: new (message: string, name: string) => Error })
    .DOMException;
  return Named ? new Named(message, name) : Object.assign(new Error(message), { name });
}

/**
 * A method taking its arguments as a rest, given the `length` the DOM's has: a script reads it
 * to know whether to pass a second.
 */
export const withLength = <T extends (...args: never[]) => unknown>(length: number, run: T): T =>
  Object.defineProperty(run, 'length', { value: length });

/** Throw as the DOM does where a method is called with fewer arguments than it requires. */
export function required(args: readonly unknown[], count: number, method: string): void {
  if (args.length < count) {
    throw new TypeError(`Failed to execute '${method}': ${count} arguments required.`);
  }
}
