/**
 * Every claim in order, later ones winning per property. A property set to `undefined` is as
 * absent as a missing one and leaves whatever the claim underneath said: `{ style: maybeStyle }`
 * compiles without `exactOptionalPropertyTypes`, and a spread would let it wipe the value.
 */
export function mergeClaims<T extends object>(claims: readonly T[]): T {
  const merged: Record<string, unknown> = {};
  for (const claim of claims) {
    for (const [key, value] of Object.entries(claim)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged as T;
}
