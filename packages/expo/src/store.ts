/**
 * `Store`, what `Storage` (`@ng-native/expo/async-storage`) and `SecureStorage`
 * (`@ng-native/expo/secure-store`) both are, over whichever native store each is bound to.
 *
 * ```ts
 * private readonly store = inject(Storage);
 * protected readonly theme = this.store.signal<'light' | 'dark'>('theme', 'light');
 * ```
 *
 * The signal is bound both ways: reading it is reading the preference, setting it persists.
 *
 * The underlying APIs are already plain promises with no React in them, so what is built is not a
 * wrapper but a *binding*: `store.signal('theme', 'light')` reads it back once, writes it through
 * whenever it is set, and is an ordinary signal in between. Everything is JSON, because both
 * stores hold strings and a store that silently held `"[object Object]"` would be worse than one
 * that held nothing.
 *
 * Two services rather than one because the difference matters and should be visible at the
 * injection site, and two entry points because each needs its own native module: Metro fails a
 * build on a `require` it cannot resolve, so one entry point for both made an app install both. `SecureStorage` is the keychain and the Android keystore: small values, an
 * async write, and a size limit that is not documented but is real. `Storage` is a plain
 * key-value file: bigger, faster, and readable by anyone with the device unlocked. Two tokens
 * over one class, for the same reason the sensors are.
 */
import { computed, signal, type Signal, type WritableSignal } from '@angular/core';

/** What both `AsyncStorage` and `SecureStore` offer, reduced to the three verbs. */
export interface NativeStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Where the platform can answer without waiting - `SecureStore` can, `AsyncStorage` cannot. */
  getSync?(key: string): string | null;
}

/** A key's signal, with what `remove()` needs to put it back. */
interface Binding {
  readonly value: WritableSignal<unknown>;
  /** The signal's own `set`, which does not write through. */
  readonly reset: (value: unknown) => void;
  readonly initial: unknown;
}

export class Store {
  private readonly native: NativeStore | null;
  private readonly bound = new Map<string, Binding>();
  /** Keys written by the app before their read came back. The read must not undo a write. */
  private readonly written = new Set<string>();
  /**
   * Updates made to a key whose read has not come back, in order. An update changes the stored
   * value rather than replacing it, so these wait for it and are applied to it, not to `initial`.
   */
  private readonly waiting = new Map<string, ((current: unknown) => unknown)[]>();
  /** Reads started and not yet back, successful or not. */
  private readonly reading = signal(0);
  private readonly failure = signal<Error | null>(null);
  /** Writes sent to the platform and not yet answered. What `flush()` waits for. */
  private readonly writes = new Set<Promise<void>>();
  /** The first write to fail since the last `flush()`, held until a flush reports it. */
  private unreported: { readonly error: unknown } | null = null;

  constructor(native: NativeStore | null) {
    this.native = native;
  }

  /**
   * Whether every key asked for so far has been read back. False while any read is outstanding,
   * so it goes back to false when a new key is asked for, and true again once that read returns.
   *
   * A read that fails still counts as back: the signal keeps its `initial`, and the failure is on
   * `error`. A loading screen held on `ready` should not wait forever for a store that is broken.
   */
  readonly ready: Signal<boolean> = computed(() => this.reading() === 0);

  /**
   * The most recent read or write that failed, or null while none has.
   *
   * A write through `set()` has no promise to reject, so this is where a full disk or a locked
   * keychain is reported. `flush()` is the way to wait on the writes themselves.
   */
  readonly error: Signal<Error | null> = this.failure.asReadonly();

  /**
   * The stored value at `key`, as a signal that writes through when set.
   *
   * Starts at `initial` and stays there until the read returns, which is one turn away at best -
   * unless the platform can answer synchronously, in which case it never shows `initial` at all.
   * The same key always returns the same signal, so two components binding to it stay in step.
   */
  signal<T>(key: string, initial: T): WritableSignal<T> {
    const existing = this.bound.get(key);
    if (existing) return existing.value as WritableSignal<T>;

    const stored = this.readSync(key);
    const value = signal<T>(stored === ABSENT ? initial : (stored as T));

    const set = value.set.bind(value);
    const update = value.update.bind(value);
    value.set = (next: T) => {
      this.written.add(key);
      this.waiting.delete(key);
      set(next);
      this.write(key, next);
    };
    value.update = (fn: (current: T) => T) => {
      // Shown at once, on what is known so far, and written once the stored value is known.
      const waiting = this.waiting.get(key);
      update(fn);
      if (waiting) {
        waiting.push(fn as (current: unknown) => unknown);
        return;
      }
      this.written.add(key);
      this.write(key, value());
    };
    this.bound.set(key, {
      value: value as WritableSignal<unknown>,
      reset: set as (value: unknown) => void,
      initial,
    });

    // A platform that answered synchronously has said what is stored; one that cannot has not.
    if (stored === ABSENT && this.native && !this.native.getSync) this.waiting.set(key, []);
    void this.hydrate(key, set, initial);
    return value;
  }

  /**
   * Forget a key, in the store and in the signal bound to it.
   *
   * The signal goes back to the `initial` it was first asked for with, and stays the one signal
   * for the key. Rejects if the platform could not remove it, which also sets `error`.
   */
  async remove(key: string): Promise<void> {
    this.written.add(key);
    this.waiting.delete(key);
    const binding = this.bound.get(key);
    binding?.reset(binding.initial);
    await this.track(this.native?.remove(key));
  }

  /**
   * Wait for every write sent so far. Rejects with the first of them that failed since the last
   * `flush()`, whether it failed before this call or while waiting, so a screen that has to know a
   * value reached the disk - before signing out, say - can find out. Each failure is reported by
   * one flush only.
   */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.writes]);
    const failed = this.unreported;
    this.unreported = null;
    if (failed) throw failed.error;
  }

  private readSync(key: string): unknown {
    let raw: string | null | undefined;
    try {
      raw = this.native?.getSync?.(key);
    } catch (error) {
      this.fail(error);
      return ABSENT;
    }
    return raw == null ? ABSENT : decode(raw);
  }

  /**
   * Read the stored value in, unless the app has already set one.
   *
   * The race is real and silent: a screen that writes a preference during startup would otherwise
   * have it overwritten a tick later by whatever was there before.
   */
  private async hydrate<T>(key: string, set: (value: T) => void, initial: T): Promise<void> {
    this.reading.update((n) => n + 1);
    let stored: unknown = ABSENT;
    try {
      const raw = await this.native?.get(key);
      if (raw != null) stored = decode(raw);
    } catch (error) {
      this.fail(error);
    } finally {
      this.settle(key, set, stored === ABSENT ? initial : stored, stored !== ABSENT);
      this.reading.update((n) => n - 1);
    }
  }

  /** The read is back: show what was stored, with any updates that waited for it applied. */
  private settle<T>(key: string, set: (value: T) => void, base: unknown, found: boolean): void {
    const updates = this.waiting.get(key);
    this.waiting.delete(key);
    if (this.written.has(key)) return;
    if (!updates?.length) {
      if (found) set(base as T);
      return;
    }
    const value = updates.reduce((current, fn) => fn(current), base);
    this.written.add(key);
    set(value as T);
    this.write(key, value);
  }

  private write(key: string, value: unknown): void {
    const sent =
      value === undefined ? this.native?.remove(key) : this.native?.set(key, JSON.stringify(value));
    // Observed here, so a failure lands on `error` and in `flush()` rather than going unhandled.
    this.track(sent).catch(() => {});
  }

  /** A platform call, kept until it answers, with its failure reported on `error`. */
  private track(sent: Promise<void> | undefined): Promise<void> {
    if (!sent) return Promise.resolve();
    const tracked = sent.then(
      () => undefined,
      (error: unknown) => {
        this.fail(error);
        this.unreported ??= { error };
        throw error;
      },
    );
    this.writes.add(tracked);
    const forget = () => void this.writes.delete(tracked);
    tracked.then(forget, forget);
    return tracked;
  }

  private fail(error: unknown): void {
    this.failure.set(error instanceof Error ? error : new Error(String(error)));
  }
}

/** What `decode` answers for a string that is not JSON, since `null` is a value JSON can hold. */
const ABSENT: unique symbol = Symbol('absent');

/**
 * A stored string as the value it encodes.
 *
 * A value that will not parse is treated as absent rather than thrown: it is a store written by
 * an older version of the app, and the right answer is the default the caller already supplied.
 * A stored `null` is not that: it parses, and a nullable signal gets it back.
 */
function decode(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return ABSENT;
  }
}
