/**
 * What HTML's text elements look like with no rule of the app's: the few a browser's own sheet
 * styles that Tailwind's preflight leaves alone. A heading and a paragraph are not here: they are
 * plain text, as preflight makes them, and the web host's reset says the same. `code` is in the
 * font each platform uses for code, by the class the root carries for its platform, as
 * `@ng-native/tailwind`'s `font-mono` is.
 *
 * `ELEMENT_STYLES` is `ELEMENT_STYLES_CSS` compiled, written out because the engine has no
 * compiler. `element-styles.test.ts` fails when the two disagree.
 */
import type { StyleSheet } from './css.ts';

export const ELEMENT_STYLES_CSS = `
strong, b { font-weight: bold }
em, i, cite { font-style: italic }
u { text-decoration-line: underline }
s { text-decoration-line: line-through }
small { font-size: 80% }
code { font-family: Courier New }
.platform-ios code { font-family: Menlo }
.platform-android code { font-family: monospace }
mark { background-color: rgb(255, 255, 0); color: rgb(0, 0, 0) }
`;

export const ELEMENT_STYLES = {
  rules: [
    {
      compounds: [{ classes: [], type: 'strong' }],
      combinators: [],
      specificity: 1,
      order: 0,
      declarations: { fontWeight: '700' },
    },
    {
      compounds: [{ classes: [], type: 'b' }],
      combinators: [],
      specificity: 1,
      order: 1,
      declarations: { fontWeight: '700' },
    },
    {
      compounds: [{ classes: [], type: 'em' }],
      combinators: [],
      specificity: 1,
      order: 2,
      declarations: { fontStyle: 'italic' },
    },
    {
      compounds: [{ classes: [], type: 'i' }],
      combinators: [],
      specificity: 1,
      order: 3,
      declarations: { fontStyle: 'italic' },
    },
    {
      compounds: [{ classes: [], type: 'cite' }],
      combinators: [],
      specificity: 1,
      order: 4,
      declarations: { fontStyle: 'italic' },
    },
    {
      compounds: [{ classes: [], type: 'u' }],
      combinators: [],
      specificity: 1,
      order: 5,
      declarations: { textDecorationLine: 'underline' },
    },
    {
      compounds: [{ classes: [], type: 's' }],
      combinators: [],
      specificity: 1,
      order: 6,
      declarations: { textDecorationLine: 'line-through' },
    },
    {
      compounds: [{ classes: [], type: 'small' }],
      combinators: [],
      specificity: 1,
      order: 7,
      declarations: {},
      deferred: [{ props: ['fontSize'], compute: { unit: 'em', factor: 0.8 } }],
    },
    {
      compounds: [{ classes: [], type: 'code' }],
      combinators: [],
      specificity: 1,
      order: 8,
      declarations: { fontFamily: 'Courier New' },
    },
    {
      compounds: [{ classes: [], type: 'mark' }],
      combinators: [],
      specificity: 1,
      order: 11,
      declarations: { backgroundColor: 'rgb(255, 255, 0)', color: 'rgb(0, 0, 0)' },
    },
    {
      compounds: [{ classes: ['platform-ios'] }, { classes: [], type: 'code' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 9,
      declarations: { fontFamily: 'Menlo' },
    },
    {
      compounds: [{ classes: ['platform-android'] }, { classes: [], type: 'code' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 10,
      declarations: { fontFamily: 'monospace' },
    },
  ],
} as unknown as StyleSheet;

/** The element names `ELEMENT_STYLES` has a rule for. */
export const STYLED_ELEMENTS: ReadonlySet<string> = new Set(
  ELEMENT_STYLES.rules.map((rule) => rule.compounds.at(-1)!.type as string),
);
