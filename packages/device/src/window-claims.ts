/**
 * What an app claims of the window: the status bar, the navigation bar, keep-awake, the orientation
 * lock, the brightness, screen capture.
 *
 * The window is the runtime's, not an app's. Android recreates an activity after a configuration
 * change it does not handle, a font size change among them: it mounts the new app on a new surface
 * and only then stops the old one. Claims kept per app would let the old app, going after the new
 * one has claimed, put the window back to the platform's own under the new app. So every app's
 * claims for one native module are kept together, in one stack per module, as React Native keeps
 * its own status bar's, and an app's claims leave with it.
 *
 * The window an app writes to can also be a new one: the recreated activity starts at the
 * platform's own, and a call that comes while no activity is current is dropped. So a source tells
 * its stack when a window comes to the front, and the stack writes the whole of it again.
 */
import { computed, signal, untracked, type Signal } from '@angular/core';
import { reactNative } from './react-native.ts';

/** One claim, and the app it came from. */
export interface Claim<T, O = unknown> {
  readonly value: T;
  readonly owner: O;
}

interface Group<T, O> {
  readonly owner: O;
  readonly base: Claim<T, O> | undefined;
  readonly pushed: readonly Claim<T, O>[];
}

/**
 * Every app's claims on one native module. An app's base claim is under its own pushed ones, and
 * an app's claims are under those of an app that claimed after it first did.
 */
export class WindowClaims<T, O extends object = object> {
  private readonly groups = signal<readonly Group<T, O>[]>([]);

  /** Every claim, the one in force last. */
  readonly all: Signal<readonly Claim<T, O>[]> = computed(() =>
    this.groups().flatMap((group) => (group.base ? [group.base, ...group.pushed] : group.pushed)),
  );

  /** The claim in force last that passes `test`. */
  last(test: (value: T) => boolean): Claim<T, O> | undefined {
    const all = this.all();
    for (let at = all.length - 1; at >= 0; at--) if (test(all[at]!.value)) return all[at];
    return undefined;
  }

  /** The apps with claims, the one that claimed first first. */
  readonly owners: Signal<readonly O[]> = computed(() => this.groups().map((group) => group.owner));

  /** `owner`'s base claim, replacing the one it had. */
  setBase(owner: O, value: T): void {
    this.update(owner, (group) => ({ ...group, base: { value, owner } }));
  }

  /** A claim of `owner`'s on top of its others. Call the returned function to drop it. */
  push(owner: O, value: T): () => void {
    const claim: Claim<T, O> = { value, owner };
    this.update(owner, (group) => ({ ...group, pushed: [...group.pushed, claim] }));
    return () =>
      this.groups.update((groups) =>
        groups.map((group) =>
          group.owner === owner
            ? { ...group, pushed: group.pushed.filter((one) => one !== claim) }
            : group,
        ),
      );
  }

  /** Every app's claims. */
  clear(): void {
    this.groups.set([]);
  }

  /** Every claim of `owner`'s, for an app that goes. */
  drop(owner: O): void {
    this.groups.update((groups) => groups.filter((group) => group.owner !== owner));
  }

  private update(owner: O, change: (group: Group<T, O>) => Group<T, O>): void {
    this.groups.update((groups) => {
      const at = groups.findIndex((group) => group.owner === owner);
      if (at === -1) return [...groups, change({ owner, base: undefined, pushed: [] })];
      return groups.map((group, index) => (index === at ? change(group) : group));
    });
  }
}

/** The one stack, or whatever a module keeps for its window, for each native module. */
const shared = new WeakMap<object, unknown>();
const ABSENT = {};

/**
 * What every app on `source` shares, made the first time one asks. `source` is the native module
 * the app writes through, or null for one that is not there.
 */
export function sharedBySource<W>(source: object | null, create: () => W): W {
  const key = source ?? ABSENT;
  if (!shared.has(key)) shared.set(key, create());
  return shared.get(key) as W;
}

/**
 * Android: calls `listener` each time an activity comes to the front, a recreated one included,
 * which starts with the platform's own window. Answers the function that stops listening. Nothing
 * on iOS, where a window keeps what it was given.
 */
export function onWindowFront(listener: () => void): () => void {
  const native = reactNative();
  if (native?.Platform?.OS !== 'android') return () => {};
  const subscription = native.AppState.addEventListener('change', (state) => {
    if (state === 'active') listener();
  });
  return () => subscription.remove();
}

/**
 * A window setting only the top claim decides, such as the orientation lock: every app's claims,
 * the one claimed last in force, and the platform's own when none is left.
 */
export class TopClaim<T> {
  readonly claims = new WindowClaims<T>();
  /** The claim the platform was last given, so a claim under it changes nothing. */
  private sent: Claim<T> | undefined;
  private readonly put: (value: T) => void;
  private readonly putBack: () => void;

  constructor(
    put: (value: T) => void,
    putBack: () => void,
    onFront?: (listener: () => void) => () => void,
  ) {
    this.put = put;
    this.putBack = putBack;
    // Lives as long as the module, which is the runtime's.
    onFront?.(() => {
      if (this.sent) this.put(this.sent.value);
    });
  }

  /** Tell the platform, if the claim in force is not the one it was last given. */
  apply(): void {
    const top = untracked(this.claims.all).at(-1);
    if (top === this.sent) return;
    this.sent = top;
    if (top) this.put(top.value);
    else this.putBack();
  }

  /** Every app's claims, and the platform's own back. */
  clear(): void {
    this.claims.clear();
    this.sent = undefined;
  }
}
