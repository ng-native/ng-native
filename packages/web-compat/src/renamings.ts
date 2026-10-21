/**
 * How many times a script has written or taken away an id or a name: what the window's named
 * properties keep what they found by, see `named-properties.ts`.
 */
let renamed = 0;

export const renamings = (): number => renamed;

/** An attribute is written or taken away: an id or a name is counted. */
export function noteRenaming(name: string): void {
  if (name === 'id' || name === 'name') renamed++;
}
