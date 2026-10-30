/**
 * `AddressSearch`: postal addresses that match what someone has typed so far, and the structured
 * address of the one they pick, from this package's native half.
 *
 * ```ts
 * private readonly search = inject(AddressSearch);
 * protected readonly query = signal('');
 * protected readonly suggestions = this.search.suggest(this.query, { region: 'GB' });
 *
 * const address = await this.search.resolve(suggestion);
 * ```
 *
 * On iOS it is MapKit's `MKLocalSearchCompleter`, which suggests as the query changes and holds
 * back while it is still changing, and `MKLocalSearch` for the picked one. On Android it is the
 * platform's `Geocoder`, asked a moment after the query stops changing: whole addresses that match,
 * rather than completions. Neither needs a permission or an API key.
 *
 * Expo Go cannot load native code of its own, and Node has none, so there the suggestions stay
 * empty and `resolve` answers null; in development it says so once.
 */
import {
  DestroyRef,
  ErrorHandler,
  InjectionToken,
  Service,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { optional } from './native.ts';

/** One address the query could be, as the platform words it. */
export interface AddressSuggestion {
  /** Tells it apart from the others, for `resolve`. Valid while its suggestions are current. */
  readonly id: string;
  /** The first line: `22 Hyde Park Terrace`. */
  readonly title: string;
  /** The rest of it, as one line: `Leeds, LS6 1BJ, England`. */
  readonly subtitle: string;
}

/** A postal address in the parts a form fills. A part the platform does not know is empty. */
export interface PostalAddress {
  /** The building and street: `22 Hyde Park Terrace`. */
  readonly line1: string;
  /** The district within the town, where the platform names one: `Headingley`. */
  readonly locality?: string;
  /** The town or city: `Leeds`. */
  readonly town: string;
  readonly postcode: string;
  /** The state, province or nation, where the platform names one: `England`. */
  readonly region?: string;
  readonly country: string;
  /** ISO 3166-1 alpha-2: `GB`. */
  readonly countryCode: string;
  readonly coordinates?: { readonly latitude: number; readonly longitude: number };
}

export interface AddressSearchOptions {
  /**
   * The country, as an ISO 3166-1 alpha-2 code (`GB`), to look in. Android answers only
   * addresses there. iOS looks in the area around the country, which can take in a neighbour's
   * border: only there from iOS 18, and there first before.
   */
  readonly region?: string;
  /** Suggest places by name, a shop or a station, as well as addresses. iOS only. */
  readonly pointsOfInterest?: boolean;
}

/** Suggestions the platform found after it answered `complete`, or better ones. */
export interface AddressSuggestionsUpdate {
  readonly session: number;
  /** The query they are for. */
  readonly query: string;
  readonly suggestions: AddressSuggestion[];
}

/** This package's native address search module. A test provides a stand-in. */
export interface NativeAddressSearch {
  /** MapKit can answer a query more than once. Android's geocoder answers once. */
  addListener?(
    event: 'onSuggestions',
    listener: (update: AddressSuggestionsUpdate) => void,
  ): { remove(): void };
  /**
   * The suggestions for `query` in a search that `session` numbers. A newer query in the same
   * session settles the one before with no suggestions.
   */
  complete(
    session: number,
    query: string,
    options: AddressSearchOptions,
  ): Promise<AddressSuggestion[]>;
  /** The address of a suggestion `complete` answered, or null for one no longer current. */
  resolve(id: string): Promise<PostalAddress | null>;
  /** Drops the search `session` numbers, and its suggestions. */
  end(session: number): void;
}

declare const ngDevMode: unknown;

const MODULE = 'NgNativeAddressSearch';

/** The module where the build has it. */
function nativeAddressSearch(): NativeAddressSearch | null {
  return optional(
    () =>
      (globalThis as { expo?: { modules?: Record<string, NativeAddressSearch | undefined> } }).expo
        ?.modules?.[MODULE] ?? null,
  );
}

let warned = false;

/** Says once, in development, that there is no native address search in this build. */
function warnMissing(): void {
  if ((typeof ngDevMode !== 'undefined' && !ngDevMode) || warned) return;
  warned = true;
  console.warn(
    '[angular-native] AddressSearch is native code of @ng-native/expo, which this build does not ' +
      'have, so it suggests nothing. Expo Go cannot load it: run a development build.',
  );
}

/** Numbers each search, across every service, as the native module tells them apart. */
let sessions = 0;

@Service()
export class AddressSearch {
  /** Overridden in a test to search a fixed list, or nothing. */
  static readonly SOURCE = new InjectionToken<NativeAddressSearch | null>(
    'angular-native.addressSearchSource',
    { factory: nativeAddressSearch },
  );

  private readonly native = inject(AddressSearch.SOURCE);

  /**
   * The addresses that match `query`, best first, as it changes: empty while it is blank. Called
   * in an injection context, a component's field, and the search ends when that is destroyed. A
   * failed search leaves the suggestions empty and goes to the `ErrorHandler`.
   */
  suggest(query: Signal<string>, options: AddressSearchOptions = {}): Signal<AddressSuggestion[]> {
    const suggestions = signal<AddressSuggestion[]>([]);
    const native = this.native;
    if (!native) {
      warnMissing();
      return suggestions.asReadonly();
    }
    const errors = inject(ErrorHandler);
    const session = ++sessions;
    let latest = 0;
    let ended = false;
    let current = '';
    const updates = native.addListener?.('onSuggestions', (update) => {
      if (update.session === session && update.query === current) {
        suggestions.set(update.suggestions);
      }
    });
    effect(() => {
      const text = query().trim();
      const asked = ++latest;
      current = text;
      if (!text) {
        suggestions.set([]);
        return;
      }
      native.complete(session, text, options).then(
        (found) => {
          if (asked === latest && !ended) suggestions.set(found);
        },
        (error: unknown) => {
          if (asked !== latest || ended) return;
          suggestions.set([]);
          errors.handleError(error);
        },
      );
    });
    inject(DestroyRef).onDestroy(() => {
      ended = true;
      updates?.remove();
      native.end(session);
    });
    return suggestions.asReadonly();
  }

  /** The structured address of a suggestion, or null where there is none to look it up in. */
  async resolve(suggestion: AddressSuggestion): Promise<PostalAddress | null> {
    if (!this.native) {
      warnMissing();
      return null;
    }
    return this.native.resolve(suggestion.id);
  }
}
