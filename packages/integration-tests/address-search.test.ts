/**
 * `AddressSearch`: suggestions that follow a query signal, and the address of a picked one.
 *
 * The native module stands in through `AddressSearch.SOURCE`, answering when the test says so, so
 * the order answers arrive in is the test's: what is pinned is that only the latest query's answer
 * is kept, that a blank query asks nothing, and that the search ends with what it was made in.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  ApplicationRef,
  EnvironmentInjector,
  ErrorHandler,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
  type Type,
} from '@angular/core';
import {
  AddressSearch,
  type AddressSearchOptions,
  type AddressSuggestion,
  type NativeAddressSearch,
  type PostalAddress,
} from '@ng-native/expo/address-search';
import { mount } from '@ng-native/platform';
import { createFakeFabric } from '@ng-native/testing';
import { compileFixture } from './compile.ts';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const hydePark = (n: number): AddressSuggestion => ({
  id: `1:${n}`,
  title: `${n} Hyde Park Terrace`,
  subtitle: 'Leeds, LS6 1BJ, England',
});

const ADDRESS: PostalAddress = {
  line1: '22 Hyde Park Terrace',
  locality: 'Headingley',
  town: 'Leeds',
  postcode: 'LS6 1BJ',
  region: 'England',
  country: 'United Kingdom',
  countryCode: 'GB',
  coordinates: { latitude: 53.81, longitude: -1.57 },
};

/** A native module whose searches wait until the test answers them. */
function fakeNative() {
  const asked: { session: number; query: string; options: AddressSearchOptions }[] = [];
  const pending: {
    answer: (found: AddressSuggestion[]) => void;
    fail: (error: Error) => void;
  }[] = [];
  const ended: number[] = [];
  const resolved: string[] = [];
  const native: NativeAddressSearch = {
    complete: (session, query, options) => {
      asked.push({ session, query, options });
      return new Promise((answer, fail) => pending.push({ answer, fail }));
    },
    resolve: async (id) => {
      resolved.push(id);
      return id === '1:22' ? ADDRESS : null;
    },
    end: (session) => void ended.push(session),
  };
  return { native, asked, pending, ended, resolved };
}

let root: EnvironmentInjector;
before(async () => {
  const mod = await compileFixture('fixtures/counter.ts');
  root = mount(1, mod['Counter'] as Type<unknown>, createFakeFabric()).componentRef.injector.get(
    EnvironmentInjector,
  );
});

function setup(native: NativeAddressSearch | null, options?: AddressSearchOptions) {
  const handled: unknown[] = [];
  const injector = createEnvironmentInjector(
    [
      { provide: AddressSearch.SOURCE, useValue: native },
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => handled.push(error) } },
    ],
    root,
  );
  const query = signal('');
  const { search, suggestions } = runInInjectionContext(injector, () => {
    const search = new AddressSearch();
    return { search, suggestions: search.suggest(query, options) };
  });
  const flush = async () => {
    root.get(ApplicationRef).tick();
    await settle();
  };
  return { search, query, suggestions, flush, handled, destroy: () => injector.destroy() };
}

describe('AddressSearch', () => {
  it('suggests the addresses that match the query as it changes, with the options given', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush } = setup(fake.native, { region: 'GB' });
    await flush();
    assert.equal(fake.asked.length, 0, 'nothing asked for a blank query');

    query.set('LS6 1BJ ');
    await flush();
    assert.equal(fake.asked.length, 1);
    assert.equal(fake.asked[0]!.query, 'LS6 1BJ', 'trimmed');
    assert.deepEqual(fake.asked[0]!.options, { region: 'GB' });
    fake.pending[0]!.answer([hydePark(22), hydePark(24)]);
    await settle();
    assert.deepEqual(
      suggestions().map(({ title }) => title),
      ['22 Hyde Park Terrace', '24 Hyde Park Terrace'],
    );
  });

  it('keeps only the latest query’s suggestions, whichever answer comes first', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush } = setup(fake.native);
    query.set('LS6');
    await flush();
    query.set('LS6 1BJ');
    await flush();
    assert.deepEqual(
      fake.asked.map(({ query }) => query),
      ['LS6', 'LS6 1BJ'],
    );
    assert.equal(fake.asked[0]!.session, fake.asked[1]!.session, 'one search, one session');

    fake.pending[1]!.answer([hydePark(22)]);
    await settle();
    fake.pending[0]!.answer([hydePark(1), hydePark(2), hydePark(3)]);
    await settle();
    assert.deepEqual(suggestions(), [hydePark(22)], 'the earlier query’s late answer is dropped');
  });

  it('empties the suggestions when the query is cleared, without asking', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush } = setup(fake.native);
    query.set('LS6');
    await flush();
    fake.pending[0]!.answer([hydePark(22)]);
    await settle();
    assert.equal(suggestions().length, 1);

    query.set('  ');
    await flush();
    assert.deepEqual(suggestions(), []);
    assert.equal(fake.asked.length, 1);
  });

  it('drops an answer to a query asked before the query was cleared', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush } = setup(fake.native);
    query.set('LS6');
    await flush();
    query.set('');
    await flush();
    fake.pending[0]!.answer([hydePark(22)]);
    await settle();
    assert.deepEqual(suggestions(), []);
  });

  it('gives each suggest() a session of its own', async () => {
    const fake = fakeNative();
    const first = setup(fake.native);
    const second = setup(fake.native);
    first.query.set('LS6');
    second.query.set('LS6');
    await first.flush();
    assert.equal(fake.asked.length, 2);
    assert.notEqual(fake.asked[0]!.session, fake.asked[1]!.session);
  });

  it('empties the suggestions and reports a failed search, and ignores a stale failure', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush, handled } = setup(fake.native);
    query.set('LS6');
    await flush();
    fake.pending[0]!.answer([hydePark(22)]);
    await settle();

    query.set('LS6 1');
    await flush();
    query.set('LS6 1B');
    await flush();
    fake.pending[1]!.fail(new Error('stale'));
    await settle();
    assert.deepEqual(handled, [], 'a failure for a query since replaced is not reported');
    assert.equal(suggestions().length, 1);

    fake.pending[2]!.fail(new Error('offline'));
    await settle();
    assert.deepEqual(suggestions(), []);
    assert.deepEqual(
      handled.map((error) => (error as Error).message),
      ['offline'],
    );
  });

  it('ends the search with the injector it was made in, and drops an answer after', async () => {
    const fake = fakeNative();
    const { query, suggestions, flush, destroy } = setup(fake.native);
    query.set('LS6');
    await flush();
    const session = fake.asked[0]!.session;
    assert.deepEqual(fake.ended, []);
    destroy();
    assert.deepEqual(fake.ended, [session]);
    fake.pending[0]!.answer([hydePark(22)]);
    await settle();
    assert.deepEqual(suggestions(), []);
  });

  it('reports no failure that arrives after the search ended', async () => {
    const fake = fakeNative();
    const { query, flush, destroy, handled } = setup(fake.native);
    query.set('LS6');
    await flush();
    destroy();
    fake.pending[0]!.fail(new Error('cancelled'));
    await settle();
    assert.deepEqual(handled, []);
  });

  it('resolves a picked suggestion to its address by id', async () => {
    const fake = fakeNative();
    const { search } = setup(fake.native);
    assert.deepEqual(await search.resolve(hydePark(22)), ADDRESS);
    assert.equal(await search.resolve(hydePark(24)), null);
    assert.deepEqual(fake.resolved, ['1:22', '1:24']);
  });

  it('suggests nothing and resolves nothing without the native module', async () => {
    const { query, suggestions, search, flush } = setup(null);
    query.set('LS6 1BJ');
    await flush();
    assert.deepEqual(suggestions(), []);
    assert.equal(await search.resolve(hydePark(22)), null);
  });

  it('finds the native module the build registers, and is inert where there is none', () => {
    // The token's own factory, which an app's root injector runs once and keeps.
    const factory = (AddressSearch.SOURCE as unknown as { ɵprov: { factory: () => unknown } }).ɵprov
      .factory;
    const host = globalThis as { expo?: unknown };
    const before = host.expo;
    const fake = fakeNative();
    try {
      host.expo = { modules: { NgNativeAddressSearch: fake.native } };
      assert.equal(factory(), fake.native);
      host.expo = { modules: {} };
      assert.equal(factory(), null);
      delete host.expo;
      assert.equal(factory(), null);
    } finally {
      host.expo = before;
    }
  });
});
