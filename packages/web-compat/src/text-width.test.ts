/**
 * How wide a text is drawn, worked out without drawing it: what a chart library lays out its
 * labels by. The widths expected are what Chrome measures with the same font, on a Mac for San
 * Francisco and with the font file an Android 15 emulator draws Roboto from.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HELVETICA, ROBOTO, SYSTEM_FONT } from './font-metrics.ts';
import { fontNamed, textWidth } from './text-width.ts';

/** Within a share of what Chrome measures. */
function near(actual: number, chrome: number, share: number): void {
  assert.ok(Math.abs(actual / chrome - 1) <= share, `${actual} is not near ${chrome}`);
}

describe('textWidth', () => {
  it('is what Chrome measures for San Francisco, by size and weight', () => {
    near(textWidth('Monthly temperature', 12.8, 400, SYSTEM_FONT), 125.25, 0.01);
    near(textWidth('Monthly temperature', 11.2, 400, SYSTEM_FONT), 111.58, 0.01);
    near(textWidth('Where time goes', 19.2, 700, SYSTEM_FONT), 153.64, 0.01);
    near(textWidth('Chrome: 63%', 9.6, 700, SYSTEM_FONT), 68.11, 0.01);
    near(textWidth('12 Jan', 14, 400, SYSTEM_FONT), 41.41, 0.01);
  });

  it('brings a pair of letters together as the font kerns them', () => {
    near(textWidth('AVA', 12.8, 700, SYSTEM_FONT), 26.19, 0.03);
    near(textWidth('Te', 14, 400, SYSTEM_FONT), 15.2, 0.04);
  });

  it('reads a weight between those measured as the nearest, and a word as its number', () => {
    const bold = textWidth('Germany', 12, 700, SYSTEM_FONT);
    assert.equal(textWidth('Germany', 12, 'bold', SYSTEM_FONT), bold);
    assert.equal(textWidth('Germany', 12, 800, SYSTEM_FONT), bold);
    assert.equal(textWidth('Germany', 12, 'normal', SYSTEM_FONT), textWidth('Germany', 12, 400));
    assert.ok(bold > textWidth('Germany', 12, 400, SYSTEM_FONT));
  });

  it('is what Chrome measures for Roboto, which Android draws in', () => {
    near(textWidth('Monthly temperature', 12.8, 400, ROBOTO), 118.6, 0.01);
    near(textWidth('Where time goes', 19.2, 700, ROBOTO), 145.33, 0.01);
  });

  it('is what Chrome measures for the Roboto of Android 12 and later, to a tenth of a pixel', () => {
    // Its many small kerning pairs add up over a word, and `fi` is one letter: an axis label a
    // tenth of a pixel wider moves the plot over by a point.
    near(textWidth('Revenue', 12.8, 400, ROBOTO), 48.41, 0.002);
    near(textWidth('Croatia', 12.8, 400, ROBOTO), 41.07, 0.002);
    near(textWidth('Profit', 12.8, 400, ROBOTO), 30.87, 0.003);
  });

  it('reads a weight heavier than bold where the font has it measured', () => {
    // A word cloud draws its words at 900, which is wider than bold.
    near(textWidth('native', 25, 900, ROBOTO), 69.24, 0.003);
    near(textWidth('signals', 11, 800, ROBOTO), 35.59, 0.003);
    assert.equal(
      textWidth('native', 25, 900, SYSTEM_FONT),
      textWidth('native', 25, 700, SYSTEM_FONT),
    );
  });

  it('measures the arrows a stock chart writes as Android draws them, from its symbol font', () => {
    // Roboto has neither: Android draws them in Noto Sans Symbols, an em and a third of one wide.
    near(textWidth('Jan 5, 2026 \u2192 Mar', 16, 400, ROBOTO), 134.44, 0.003);
    near(textWidth('All \u25be', 14, 700, ROBOTO), 25.25, 0.01);
  });

  it('is what Chrome on a Mac measures for Helvetica, its sans-serif, which has no 900', () => {
    // A word cloud draws its words in sans-serif at 900: Chrome draws them in Helvetica Bold.
    near(textWidth('native', 25, 900, HELVETICA), 72.25, 0.003);
    near(textWidth('Angular', 30, 900, HELVETICA), 113.33, 0.003);
    near(textWidth('Monthly temperature', 12.8, 400, HELVETICA), 117.39, 0.003);
    near(textWidth('Yearly Total', 14, 700, HELVETICA), 77.57, 0.003);
  });

  it('draws a font stack in the first family of it the platform has, as Chrome on a Mac does', () => {
    // Highcharts' own stack starts with the system font, and its word cloud asks for sans-serif.
    const stack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif';
    assert.deepEqual(fontNamed(stack, 'ios'), { family: undefined, metrics: SYSTEM_FONT });
    assert.deepEqual(fontNamed('sans-serif', 'ios'), { family: 'Helvetica', metrics: HELVETICA });
    assert.deepEqual(fontNamed('"Segoe UI", Arial', 'ios'), {
      family: 'Arial',
      metrics: HELVETICA,
    });
    assert.deepEqual(fontNamed("'Segoe UI', Tahoma", 'ios'), {
      family: undefined,
      metrics: SYSTEM_FONT,
    });
    assert.deepEqual(fontNamed(undefined, 'ios'), { family: undefined, metrics: SYSTEM_FONT });
    // Android draws each of these in Roboto, its system font.
    assert.deepEqual(fontNamed('sans-serif', 'android'), { family: undefined, metrics: ROBOTO });
    assert.deepEqual(fontNamed('Helvetica', 'android'), { family: undefined, metrics: ROBOTO });
  });

  it('tracks no letter of no width, as Chrome draws the space Highcharts breaks a line at', () => {
    assert.equal(textWidth('\u200b', 11, 400, SYSTEM_FONT), 0);
    assert.equal(textWidth('a\u200b', 11, 400, SYSTEM_FONT), textWidth('a', 11, 400, SYSTEM_FONT));
  });

  it('gives a character it has no width for the width of a wide letter', () => {
    assert.ok(textWidth('東京', 12, 400) >= 20);
    assert.equal(textWidth('', 12, 400), 0);
  });
  it('has a width for every character of each font, in every weight, as the tooltip bullet needs', () => {
    for (const font of [SYSTEM_FONT, HELVETICA, ROBOTO]) {
      const count = [...font.chars].length;
      for (const widths of Object.values(font.weights)) assert.equal(widths.length, count);
    }
    near(textWidth('\u25cf', 1000, 700, HELVETICA), 604, 0.01);
  });
});
