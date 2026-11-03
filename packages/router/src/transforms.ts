/**
 * Input transforms that keep an unset prop unset, so a header that never mentions `largeTitle`
 * sends nothing rather than `false`. The same pair exists in the components package; see
 * `own-host.ts` for why it is copied rather than imported.
 */
import { booleanAttribute, numberAttribute } from '@angular/core';

export function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : booleanAttribute(value);
}

/** `null` is unset too, as the usual way to bind no number, where `numberAttribute` makes it NaN. */
export function optionalNumber(value: unknown): number | undefined {
  return value == null ? undefined : numberAttribute(value);
}
