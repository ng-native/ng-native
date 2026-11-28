/**
 * `Intl.NumberFormat`'s `formatToParts` where the runtime has none, as Hermes has none: what a
 * library's number mask reads a locale's digit groups from.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installNumberParts } from './number-parts.ts';

type Formatter = Intl.NumberFormat & { formatToParts(value: unknown): Intl.NumberFormatPart[] };

describe('formatToParts where the runtime has none', () => {
  it('names the parts a number is written in as the runtime that has one does', () => {
    const proto = Intl.NumberFormat.prototype as Formatter;
    const own = Object.getOwnPropertyDescriptor(proto, 'formatToParts')!;
    const cases: [string, object, unknown][] = [
      ['en-US', { maximumFractionDigits: 0 }, BigInt('1000000')],
      ['en-US', {}, -1234.5],
      ['de-DE', {}, 1234567.25],
      ['fr-FR', {}, 9876543.5],
      ['ar-EG', {}, 1234.5],
      ['hi-IN', {}, 1234567],
      ['en-US', { numberingSystem: 'arab' }, 1234.5],
      ['bn', {}, 1234.5],
      ['fa', {}, -1234.5],
      ['en-US', { signDisplay: 'always' }, 1],
      ['ar-EG', { signDisplay: 'always' }, 5],
      ['en-US', {}, NaN],
      ['en-US', {}, -Infinity],
      ['ar-EG', { signDisplay: 'always' }, NaN],
    ];
    const expected = cases.map(([locale, options, value]) =>
      (new Intl.NumberFormat(locale, options) as Formatter).formatToParts(value),
    );
    delete (proto as Partial<Formatter>).formatToParts;
    try {
      const undo = installNumberParts();
      const actual = cases.map(([locale, options, value]) =>
        (new Intl.NumberFormat(locale, options) as Formatter).formatToParts(value),
      );
      assert.deepEqual(actual, expected);
      undo();
      assert.equal((proto as Partial<Formatter>).formatToParts, undefined);
    } finally {
      Object.defineProperty(proto, 'formatToParts', own);
    }
  });

  it('formats a BigInt as a number, as Hermes formats none', () => {
    const proto = Intl.NumberFormat.prototype as Formatter;
    const own = Object.getOwnPropertyDescriptor(proto, 'formatToParts')!;
    const format = Object.getOwnPropertyDescriptor(proto, 'format')!;
    const expected = (new Intl.NumberFormat('en-US') as Formatter).formatToParts(1000000);
    delete (proto as Partial<Formatter>).formatToParts;
    // Hermes's: no BigInt taken.
    Object.defineProperty(proto, 'format', {
      configurable: true,
      get() {
        const written = format.get!.call(this) as (value: unknown) => string;
        return (value: unknown) => {
          if (typeof value === 'bigint') throw new TypeError('Cannot convert BigInt to number');
          return written(value);
        };
      },
    });
    try {
      const undo = installNumberParts();
      const actual = (new Intl.NumberFormat('en-US') as Formatter).formatToParts(BigInt(1000000));
      undo();
      assert.deepEqual(actual, expected);
    } finally {
      Object.defineProperty(proto, 'format', format);
      Object.defineProperty(proto, 'formatToParts', own);
    }
  });

  it("gives the runtime's own a BigInt as a number, where it refuses one as Hermes's does", () => {
    const proto = Intl.NumberFormat.prototype as Formatter;
    const own = Object.getOwnPropertyDescriptor(proto, 'formatToParts')!;
    const expected = (new Intl.NumberFormat('en-US') as Formatter).formatToParts(1000);
    // Android's Hermes: a formatToParts of its own that takes no BigInt.
    Object.defineProperty(proto, 'formatToParts', {
      configurable: true,
      writable: true,
      value(this: Intl.NumberFormat, value: unknown) {
        if (typeof value === 'bigint') throw new TypeError('Cannot convert BigInt to number');
        return own.value.call(this, value);
      },
    });
    try {
      const undo = installNumberParts();
      assert.deepEqual(
        (new Intl.NumberFormat('en-US') as Formatter).formatToParts(BigInt(1000)),
        expected,
      );
      undo();
      assert.throws(() => (new Intl.NumberFormat('en-US') as Formatter).formatToParts(BigInt(1)));
    } finally {
      Object.defineProperty(proto, 'formatToParts', own);
    }
  });

  it("leaves the runtime's own alone", () => {
    const before = Intl.NumberFormat.prototype.formatToParts;
    installNumberParts()();
    assert.equal(Intl.NumberFormat.prototype.formatToParts, before);
  });
});
