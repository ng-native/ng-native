/**
 * Input transforms for numbers and switches written as static attributes, which arrive as
 * strings, that keep an unset prop unset rather than sending `false` or `NaN`. The same pair
 * exists in the components and router packages; this package does not depend on either.
 */
import { booleanAttribute, numberAttribute } from '@angular/core';

/** `null` is unset too, as `undefined` is, where `booleanAttribute` makes it false. */
export function optionalBoolean(value: unknown): boolean | undefined {
  return value == null ? undefined : booleanAttribute(value);
}

/** `null` is unset too, as the usual way to bind no number, where `numberAttribute` makes it NaN. */
export function optionalNumber(value: unknown): number | undefined {
  return value == null ? undefined : numberAttribute(value);
}

/**
 * The transform for a boolean input with a default: `[enabled]="undefined"` or `null` is the
 * default, as a prop left out is, where `booleanAttribute` alone makes both `false`.
 */
export function booleanOr(fallback: boolean): (value: unknown) => boolean {
  return (value) => (value == null ? fallback : booleanAttribute(value));
}
