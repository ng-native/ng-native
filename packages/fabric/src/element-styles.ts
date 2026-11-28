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
.platform-macos code { font-family: Menlo }
.platform-linux code { font-family: monospace }
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
      order: 13,
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
    {
      compounds: [{ classes: ['platform-macos'] }, { classes: [], type: 'code' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 11,
      declarations: { fontFamily: 'Menlo' },
    },
    {
      compounds: [{ classes: ['platform-linux'] }, { classes: [], type: 'code' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 12,
      declarations: { fontFamily: 'monospace' },
    },
  ],
} as unknown as StyleSheet;

/** The element names `ELEMENT_STYLES` has a rule for. */
export const STYLED_ELEMENTS: ReadonlySet<string> = new Set(
  ELEMENT_STYLES.rules.map((rule) => rule.compounds.at(-1)!.type as string),
);

/**
 * What a browser's own stylesheet gives HTML's blocks: a paragraph's and a list's margins, a
 * heading's size, weight and margins, a quote's and a list's indent. Under every rule a stylesheet
 * writes, as `ELEMENT_STYLES` are, and only for an element a package says is a browser's: see
 * `Engine.giveBrowserStyles`. An app's own templates keep their plain text.
 *
 * `BROWSER_STYLES` is `BROWSER_STYLES_CSS` compiled, written out as `ELEMENT_STYLES` is.
 */
export const BROWSER_STYLES_CSS = `
p { margin-top: 1em; margin-bottom: 1em }
h1 { font-size: 2em; font-weight: bold; margin-top: 0.67em; margin-bottom: 0.67em }
h2 { font-size: 1.5em; font-weight: bold; margin-top: 0.83em; margin-bottom: 0.83em }
h3 { font-size: 1.17em; font-weight: bold; margin-top: 1em; margin-bottom: 1em }
h4 { font-weight: bold; margin-top: 1.33em; margin-bottom: 1.33em }
h5 { font-size: 0.83em; font-weight: bold; margin-top: 1.67em; margin-bottom: 1.67em }
h6 { font-size: 0.67em; font-weight: bold; margin-top: 2.33em; margin-bottom: 2.33em }
ul, ol, menu, dl { margin-top: 1em; margin-bottom: 1em }
ul, ol, menu { padding-inline-start: 40px }
ul ul, ul ol, ol ul, ol ol { margin-top: 0; margin-bottom: 0 }
dd { margin-inline-start: 40px }
blockquote, figure { margin-top: 1em; margin-bottom: 1em; margin-left: 40px; margin-right: 40px }
pre { margin-top: 1em; margin-bottom: 1em; font-family: Courier New }
.platform-ios pre { font-family: Menlo }
.platform-android pre { font-family: monospace }
.platform-macos pre { font-family: Menlo }
.platform-linux pre { font-family: monospace }
hr { margin-top: 0.5em; margin-bottom: 0.5em; border-width: 1px; border-style: solid; border-color: rgb(192, 192, 192) }
fieldset { margin-left: 2px; margin-right: 2px; padding: 0.35em 0.75em 0.625em; border-width: 2px; border-style: solid; border-color: rgb(192, 192, 192) }
legend { padding-left: 2px; padding-right: 2px }
`;

export const BROWSER_STYLES = {
  rules: [
    {
      compounds: [{ classes: [], type: 'p' }],
      combinators: [],
      specificity: 1,
      order: 0,
      declarations: {},
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h1' }],
      combinators: [],
      specificity: 1,
      order: 1,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['fontSize'], compute: { unit: 'em', factor: 2 } },
        { props: ['marginTop'], compute: { unit: 'em', factor: 0.67 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 0.67 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h2' }],
      combinators: [],
      specificity: 1,
      order: 2,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['fontSize'], compute: { unit: 'em', factor: 1.5 } },
        { props: ['marginTop'], compute: { unit: 'em', factor: 0.83 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 0.83 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h3' }],
      combinators: [],
      specificity: 1,
      order: 3,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['fontSize'], compute: { unit: 'em', factor: 1.17 } },
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h4' }],
      combinators: [],
      specificity: 1,
      order: 4,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1.33 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1.33 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h5' }],
      combinators: [],
      specificity: 1,
      order: 5,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['fontSize'], compute: { unit: 'em', factor: 0.83 } },
        { props: ['marginTop'], compute: { unit: 'em', factor: 1.67 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1.67 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'h6' }],
      combinators: [],
      specificity: 1,
      order: 6,
      declarations: { fontWeight: '700' },
      deferred: [
        { props: ['fontSize'], compute: { unit: 'em', factor: 0.67 } },
        { props: ['marginTop'], compute: { unit: 'em', factor: 2.33 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 2.33 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'ul' }],
      combinators: [],
      specificity: 1,
      order: 7,
      declarations: {},
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'ol' }],
      combinators: [],
      specificity: 1,
      order: 8,
      declarations: {},
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'menu' }],
      combinators: [],
      specificity: 1,
      order: 9,
      declarations: {},
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'dl' }],
      combinators: [],
      specificity: 1,
      order: 10,
      declarations: {},
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'ul' }],
      combinators: [],
      specificity: 1,
      order: 11,
      declarations: { paddingStart: 40 },
    },
    {
      compounds: [{ classes: [], type: 'ol' }],
      combinators: [],
      specificity: 1,
      order: 12,
      declarations: { paddingStart: 40 },
    },
    {
      compounds: [{ classes: [], type: 'menu' }],
      combinators: [],
      specificity: 1,
      order: 13,
      declarations: { paddingStart: 40 },
    },
    {
      compounds: [{ classes: [], type: 'dd' }],
      combinators: [],
      specificity: 1,
      order: 18,
      declarations: { marginStart: 40 },
    },
    {
      compounds: [{ classes: [], type: 'blockquote' }],
      combinators: [],
      specificity: 1,
      order: 19,
      declarations: { marginLeft: 40, marginRight: 40 },
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'figure' }],
      combinators: [],
      specificity: 1,
      order: 20,
      declarations: { marginLeft: 40, marginRight: 40 },
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'pre' }],
      combinators: [],
      specificity: 1,
      order: 21,
      declarations: { fontFamily: 'Courier New' },
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 1 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 1 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'hr' }],
      combinators: [],
      specificity: 1,
      order: 26,
      declarations: {
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: 1,
        borderStyle: 'solid',
        borderTopStyle: 'solid',
        borderRightStyle: 'solid',
        borderBottomStyle: 'solid',
        borderLeftStyle: 'solid',
        borderTopColor: 'rgb(192, 192, 192)',
        borderRightColor: 'rgb(192, 192, 192)',
        borderBottomColor: 'rgb(192, 192, 192)',
        borderLeftColor: 'rgb(192, 192, 192)',
      },
      deferred: [
        { props: ['marginTop'], compute: { unit: 'em', factor: 0.5 } },
        { props: ['marginBottom'], compute: { unit: 'em', factor: 0.5 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'fieldset' }],
      combinators: [],
      specificity: 1,
      order: 27,
      declarations: {
        marginLeft: 2,
        marginRight: 2,
        borderTopWidth: 2,
        borderRightWidth: 2,
        borderBottomWidth: 2,
        borderLeftWidth: 2,
        borderStyle: 'solid',
        borderTopStyle: 'solid',
        borderRightStyle: 'solid',
        borderBottomStyle: 'solid',
        borderLeftStyle: 'solid',
        borderTopColor: 'rgb(192, 192, 192)',
        borderRightColor: 'rgb(192, 192, 192)',
        borderBottomColor: 'rgb(192, 192, 192)',
        borderLeftColor: 'rgb(192, 192, 192)',
      },
      deferred: [
        { props: ['paddingTop'], compute: { unit: 'em', factor: 0.35 } },
        { props: ['paddingRight'], compute: { unit: 'em', factor: 0.75 } },
        { props: ['paddingBottom'], compute: { unit: 'em', factor: 0.625 } },
        { props: ['paddingLeft'], compute: { unit: 'em', factor: 0.75 } },
      ],
    },
    {
      compounds: [{ classes: [], type: 'legend' }],
      combinators: [],
      specificity: 1,
      order: 28,
      declarations: { paddingLeft: 2, paddingRight: 2 },
    },
    {
      compounds: [
        { classes: [], type: 'ul' },
        { classes: [], type: 'ul' },
      ],
      combinators: ['descendant'],
      specificity: 2,
      order: 14,
      declarations: { marginTop: 0, marginBottom: 0 },
    },
    {
      compounds: [
        { classes: [], type: 'ul' },
        { classes: [], type: 'ol' },
      ],
      combinators: ['descendant'],
      specificity: 2,
      order: 15,
      declarations: { marginTop: 0, marginBottom: 0 },
    },
    {
      compounds: [
        { classes: [], type: 'ol' },
        { classes: [], type: 'ul' },
      ],
      combinators: ['descendant'],
      specificity: 2,
      order: 16,
      declarations: { marginTop: 0, marginBottom: 0 },
    },
    {
      compounds: [
        { classes: [], type: 'ol' },
        { classes: [], type: 'ol' },
      ],
      combinators: ['descendant'],
      specificity: 2,
      order: 17,
      declarations: { marginTop: 0, marginBottom: 0 },
    },
    {
      compounds: [{ classes: ['platform-ios'] }, { classes: [], type: 'pre' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 22,
      declarations: { fontFamily: 'Menlo' },
    },
    {
      compounds: [{ classes: ['platform-android'] }, { classes: [], type: 'pre' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 23,
      declarations: { fontFamily: 'monospace' },
    },
    {
      compounds: [{ classes: ['platform-macos'] }, { classes: [], type: 'pre' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 24,
      declarations: { fontFamily: 'Menlo' },
    },
    {
      compounds: [{ classes: ['platform-linux'] }, { classes: [], type: 'pre' }],
      combinators: ['descendant'],
      specificity: 1001,
      order: 25,
      declarations: { fontFamily: 'monospace' },
    },
  ],
} as unknown as StyleSheet;
