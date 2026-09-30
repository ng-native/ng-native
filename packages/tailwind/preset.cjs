/**
 * The native preset, for Tailwind 3.
 *
 *   // tailwind.config.js
 *   module.exports = {
 *     presets: [require('@ng-native/tailwind/preset.cjs')],
 *     content: ['./src/**\/*.{ts,html}'],
 *   };
 *
 * There is no `presets` key here, so Tailwind 3 adds its default configuration beneath this preset,
 * which is what an app using it alone needs. Beside another preset that also brings the defaults,
 * the later one's defaults override the earlier one's theme, so an app lists this one after its own
 * preset as `{ ...require('@ng-native/tailwind/preset.cjs'), presets: [] }`.
 *
 * The same vocabulary as `native.css`, which is the Tailwind 4 preset, in the JavaScript form
 * Tailwind 3 takes: read the two side by side, and change them together. Every choice is explained
 * there and in `shared.css`; this file only says how each one is spelt here.
 *
 * The plugin is a plain function rather than `require('tailwindcss/plugin')(...)`, which Tailwind 3
 * accepts, so this file resolves nothing from the app.
 */

/** The four safe-area edges, keyed by the letter a spacing utility uses for them. */
const EDGES = { t: 'top', r: 'right', b: 'bottom', l: 'left' };

/** `var(--safe-area-inset-top, 0px)`: the inset `<safe-area-provider>` sets on the root. */
const inset = (edge) => `var(--safe-area-inset-${edge}, 0px)`;

const HAIRLINE = 'var(--hairline, 1px)';

/** The first family a `fontFamily` theme value names, in any of the forms Tailwind 3 takes. */
const firstFamily = (value) =>
  String([value].flat(2)[0] ?? '')
    .split(',')[0]
    .trim();

function nativePreset({ addBase, addUtilities, addVariant, config, matchUtilities, theme }) {
  // `hover:` is the pressed state, or a real hover where there is a pointer.
  addVariant('hover', ['&:active', '&[data-hover]']);
  addVariant('press', '&:active');
  addVariant('hovered', '&[data-hover]');
  // `focus-visible:` is `focus:`, and both follow the state attribute.
  addVariant('focus-visible', ['&:focus', '&[data-focus]']);
  addVariant('focus', ['&:focus', '&[data-focus]']);
  addVariant('disabled', ['&[data-disabled]', '&:disabled']);

  // Tailwind 3 builds `group-*:` and `peer-*:` from the pseudo-class itself rather than from the
  // variants above, so each state is spelt again for an ancestor `.group` and an earlier `.peer`.
  const states = {
    hover: [':active', '[data-hover]'],
    focus: [':focus', '[data-focus]'],
    'focus-visible': [':focus', '[data-focus]'],
    disabled: ['[data-disabled]', ':disabled'],
  };
  for (const [state, selectors] of Object.entries(states)) {
    addVariant(
      `group-${state}`,
      selectors.map((s) => `:merge(.group)${s} &`),
    );
    addVariant(
      `peer-${state}`,
      selectors.map((s) => `:merge(.peer)${s} ~ &`),
    );
  }

  // The platform, from a class on the root.
  addVariant('ios', '.platform-ios &');
  addVariant('android', '.platform-android &');
  addVariant('web', '.platform-web &');
  addVariant('native', ['.platform-ios &', '.platform-android &']);
  // Tailwind 3 puts an app's `prefix` on every class in these, `.tw-platform-ios &` and `.tw-dark &`,
  // and nothing sets those on the root. The prefix is recorded for `flattenTailwind`, which takes
  // it back off the root classes.
  if (config('prefix')) {
    addBase({ ':root': { '--ng-native-tailwind-prefix': JSON.stringify(config('prefix')) } });
  }

  const safe = {
    '.p-safe': Object.fromEntries(
      Object.values(EDGES).map((edge) => [`padding-${edge}`, inset(edge)]),
    ),
    '.px-safe': { 'padding-right': inset('right'), 'padding-left': inset('left') },
    '.py-safe': { 'padding-top': inset('top'), 'padding-bottom': inset('bottom') },
  };
  for (const [letter, edge] of Object.entries(EDGES)) {
    safe[`.p${letter}-safe`] = { [`padding-${edge}`]: inset(edge) };
    safe[`.m${letter}-safe`] = { [`margin-${edge}`]: inset(edge) };
  }
  addUtilities(safe);

  // The inset plus a step off the spacing scale, and whichever of the two is larger.
  // Lengths only: a bare number after the inset is no length, and a browser drops it.
  const spacing = { values: theme('spacing'), type: ['length', 'percentage'] };
  for (const [letter, edge] of [
    ['t', 'top'],
    ['b', 'bottom'],
  ]) {
    matchUtilities(
      {
        [`p${letter}-safe`]: (step) => ({ [`padding-${edge}`]: `calc(${inset(edge)} + ${step})` }),
        [`m${letter}-safe`]: (step) => ({ [`margin-${edge}`]: `calc(${inset(edge)} + ${step})` }),
        [`min-p${letter}-safe`]: (step) => ({
          [`padding-${edge}`]: `max(${inset(edge)}, ${step})`,
        }),
      },
      spacing,
    );
  }

  const hairlines = {
    '.h-hairline': { height: HAIRLINE },
    '.w-hairline': { width: HAIRLINE },
    '.border-hairline': { 'border-style': 'solid', 'border-width': HAIRLINE },
  };
  for (const [letter, edge] of Object.entries(EDGES)) {
    hairlines[`.border-${letter}-hairline`] = {
      'border-style': 'solid',
      'border-width': '0',
      [`border-${edge}-width`]: HAIRLINE,
    };
  }
  addUtilities(hairlines);

  // `font-mono`, when it is still Tailwind's own stack, whose first family, `ui-monospace`, is on
  // neither platform: `Courier New` on both, upgraded to the font each platform uses for code. An
  // app that names its own monospace font keeps it. Utilities rather than base rules, so an app's
  // `important: true` makes them important too, and the platform rules still win.
  if (firstFamily(theme('fontFamily.mono')) === 'ui-monospace') {
    addUtilities({
      '.font-mono': { 'font-family': 'Courier New' },
      '.platform-ios .font-mono': { 'font-family': 'Menlo' },
      '.platform-android .font-mono': { 'font-family': 'monospace' },
    });
  }
}

module.exports = {
  // A class seeded from the OS, so an app can disagree with it.
  darkMode: ['variant', '.dark &'],
  // A browser reset in terms of `html` and `::before`, none of which means anything on a phone.
  corePlugins: { preflight: false },
  plugins: [nativePreset],
};
