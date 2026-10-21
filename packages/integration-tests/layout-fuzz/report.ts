/**
 * What a run found: each case's outcome counted, the shrunk mismatches grouped into classes and
 * families, and both written out as text to read and JSON to replay from.
 */
import { outline, stylesheet, type Case } from './case.ts';
import { family, signature } from './classify.ts';
import { describeDifference, type Difference } from './compare.ts';
import { weight } from './shrink.ts';

export type Outcome =
  | { kind: 'threw'; error: string }
  | { kind: 'refused'; refused: readonly string[] }
  | { kind: 'unmodelled'; props: readonly string[] }
  | { kind: 'match' }
  | { kind: 'mismatch'; differences: Difference[] };

export const KINDS = ['match', 'mismatch', 'refused', 'unmodelled', 'threw'] as const;

interface Group {
  seeds: number[];
  /** The classes in a family; a class lists itself. */
  members: string[];
  smallest: Case;
  differences: Difference[];
}

const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

/** How many cases each outcome had, and what the compiler refused, by property. */
export function tally(cases: readonly Case[], outcomes: readonly Outcome[]) {
  const counts = Object.fromEntries(
    KINDS.map((kind) => [kind, outcomes.filter((o) => o.kind === kind).length]),
  ) as Record<(typeof KINDS)[number], number>;
  const refused = new Map<string, number>();
  const unmodelled = new Map<string, number>();
  const threw = new Map<string, number[]>();
  outcomes.forEach((outcome, i) => {
    if (outcome.kind === 'refused') {
      const properties = outcome.refused.map((m) => /dropped '([^']+)'/.exec(m)?.[1] ?? m);
      for (const property of new Set(properties)) bump(refused, property);
    }
    if (outcome.kind === 'unmodelled') for (const prop of outcome.props) bump(unmodelled, prop);
    if (outcome.kind === 'threw') {
      const key = outcome.error.split(' | ')[0]!;
      threw.set(key, [...(threw.get(key) ?? []), cases[i]!.seed]);
    }
  });
  return { counts, refused, unmodelled, threw };
}

export type Tally = ReturnType<typeof tally>;

/** Shrunk mismatches by class, each class keeping the smallest case that shows it. */
export class Classes {
  readonly byKey = new Map<string, Group>();

  add(seed: number, small: Case, found: Difference[]): void {
    const key = signature(small, found[0]!);
    merge(this.byKey, key, { seeds: [seed], members: [key], smallest: small, differences: found });
  }

  /** The classes grouped by family, the family with the most cases first. */
  families(): [string, Group][] {
    const out = new Map<string, Group>();
    for (const [key, group] of this.byKey)
      merge(out, family(key), { ...group, seeds: [...group.seeds], members: [...group.members] });
    return ranked(out);
  }

  ranked(): [string, Group][] {
    return ranked(this.byKey);
  }
}

function merge(into: Map<string, Group>, key: string, group: Group): void {
  const known = into.get(key);
  if (!known) {
    into.set(key, group);
    return;
  }
  known.seeds.push(...group.seeds);
  for (const member of group.members)
    if (!known.members.includes(member)) known.members.push(member);
  if (weight(group.smallest) < weight(known.smallest)) {
    known.smallest = group.smallest;
    known.differences = group.differences;
  }
}

const ranked = (groups: Map<string, Group>) =>
  [...groups.entries()].sort((a, b) => b[1].seeds.length - a[1].seeds.length);

const indented = (text: string) => text.split('\n').map((line) => `  | ${line}`);

const counted = (title: string, entries: Iterable<[string, number]>): string[] => {
  const rows = [...entries].sort((a, b) => b[1] - a[1]).map(([what, n]) => `  ${n}  ${what}`);
  return rows.length ? [title, ...rows, ''] : [];
};

export function formatReport(
  heading: string,
  found: Tally,
  classes: Classes,
  unshrunk: number,
): string {
  const { counts } = found;
  const families = classes.families();
  const shrunk = [...classes.byKey.values()].reduce((n, group) => n + group.seeds.length, 0);
  return [
    heading,
    `  match ${counts.match}, mismatch ${counts.mismatch}, refused by the compiler ${counts.refused}, unmodelled by the harness ${counts.unmodelled}, threw ${counts.threw}`,
    `  ${shrunk} mismatches shrunk into ${classes.byKey.size} classes in ${families.length} families${unshrunk ? `, ${unshrunk} not shrunk` : ''}`,
    '',
    ...counted('Refused by the compiler (cases):', found.refused),
    ...counted('Committed props the harness cannot lay out (cases):', found.unmodelled),
    ...counted(
      'Threw (cases):',
      [...found.threw].map(([error, seeds]) => [
        `${error}  (seeds ${seeds.slice(0, 5).join(', ')})`,
        seeds.length,
      ]),
    ),
    ...families.flatMap(([key, group], rank) => [
      `#${rank + 1}  ${group.seeds.length} cases, ${group.members.length} classes  ${key}`,
      `  seeds ${group.seeds.slice(0, 8).join(', ')}${group.seeds.length > 8 ? ', ...' : ''}`,
      ...indented(outline(group.smallest.root)),
      ...indented(stylesheet(group.smallest.root)),
      ...group.differences.map((d) => `  ${describeDifference(d)}`),
      '',
    ]),
  ].join('\n');
}

const asJson = ([key, group]: [string, Group]) => ({
  key,
  cases: group.seeds.length,
  seeds: group.seeds,
  classes: group.members,
  css: stylesheet(group.smallest.root),
  tree: outline(group.smallest.root),
  case: group.smallest,
  differences: group.differences,
});

export function resultsJson(run: Record<string, unknown>, found: Tally, classes: Classes): string {
  return JSON.stringify(
    {
      ...run,
      counts: found.counts,
      refused: Object.fromEntries(found.refused),
      unmodelled: Object.fromEntries(found.unmodelled),
      threw: Object.fromEntries(found.threw),
      families: classes.families().map(asJson),
      classes: classes.ranked().map(asJson),
    },
    null,
    1,
  );
}
