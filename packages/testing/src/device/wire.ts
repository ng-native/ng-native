/**
 * The pool's requests to the app, as JSON. Vitest's `-t` reaches a worker as a RegExp, in the
 * config and in each file it runs, which plain JSON would turn into `{}`: a RegExp goes as its
 * source and flags, and comes back as one.
 */
const KEY = '__ngNativeRegExp__';

/** A request, as text for the app. */
export function writeRequest(request: unknown): string {
  return JSON.stringify(request, (_, value: unknown) =>
    value instanceof RegExp ? { [KEY]: [value.source, value.flags] } : value,
  );
}

/** A request from the pool, its RegExps made again. */
export function readRequest(text: string): unknown {
  return JSON.parse(text, (_, value: unknown) => {
    const pair = (value as Record<string, [string, string]> | null)?.[KEY];
    return pair ? new RegExp(pair[0], pair[1]) : value;
  });
}
