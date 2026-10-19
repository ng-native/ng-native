import { serializeIdentifier } from './css-value.ts';
import { withLength } from './dom-error.ts';
import { readsCondition, readsDeclaration } from './runtime-style.ts';

/**
 * The `CSS` global: `escape` and `supports`.
 *
 * `supports` answers for what a script can style with once it has asked, which is a `<style>` it
 * makes as the app runs: see `runtime-style.ts`, whose reader is what answers. A stylesheet the
 * build compiled has its own reader, and no `@supports` in it at all (the build refuses one), so
 * nothing a library asks here is answered by it. A property or a value that reader passes over
 * is not supported, though the engine may draw it from a stylesheet the build compiled: a
 * library told no takes the branch for an older browser, which draws, where told yes it would
 * write what is dropped.
 */

/** `CSS.escape`, as the CSSOM serialises an identifier. */
function escape(...args: unknown[]): string {
  if (!args.length) throw new TypeError("Failed to execute 'escape' on 'CSS': 1 argument required");
  return serializeIdentifier(String(args[0]));
}

/** `CSS.supports(property, value)`, or `CSS.supports(conditionText)`. */
function supports(...args: unknown[]): boolean {
  if (!args.length) {
    throw new TypeError("Failed to execute 'supports' on 'CSS': 1 argument required");
  }
  if (args.length > 1) {
    const property = String(args[0]);
    return property === property.trim() && readsDeclaration(property, String(args[1]));
  }
  const text = String(args[0]);
  return readsCondition(text) || readsCondition(`(${text})`);
}

/** `CSS`, which says what it is as a namespace object does. */
export const cssNamespace = Object.defineProperty(
  { escape: withLength(1, escape), supports },
  Symbol.toStringTag,
  {
    value: 'CSS',
    configurable: true,
  },
);
