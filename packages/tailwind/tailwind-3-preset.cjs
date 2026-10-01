/**
 * The Tailwind 3 presets, `preset.cjs` for native and `web-preset.cjs` for a browser, both built by
 * `tailwind3Preset(platform)`.
 *
 * There is no `presets` key here, so Tailwind 3 adds its default configuration beneath this preset,
 * which is what an app using it alone needs. Beside another preset that also brings the defaults,
 * the later one's defaults override the earlier one's theme, so an app lists this one after its own
 * preset as `{ ...require('@ng-native/tailwind/preset.cjs'), presets: [] }`.
 *
 * The same vocabulary as `native.css` and `web.css`, which are the Tailwind 4 presets, in the
 * JavaScript form Tailwind 3 takes: read them side by side, and change them together. Every choice
 * is explained there and in `shared.css`; this file only says how each one is spelt here.
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

/**
 * The states each variant reads. On native, `hover:` is the pressed state, or a real hover where
 * there is a pointer, and `focus-visible:` is `focus:`. A browser has `:hover` and `:focus-visible`
 * for real, so there they lead and the others stay, as in `web.css`.
 */
const STATES = {
  native: {
    hover: [':active', '[data-hover]'],
    hovered: ['[data-hover]'],
    focus: [':focus', '[data-focus]'],
    'focus-visible': [':focus', '[data-focus]'],
    disabled: ['[data-disabled]', ':disabled'],
  },
  web: {
    hover: [':hover', ':active', '[data-hover]'],
    hovered: [':hover', '[data-hover]'],
    focus: [':focus', '[data-focus]'],
    'focus-visible': [':focus-visible', '[data-focus]'],
    disabled: ['[data-disabled]', ':disabled'],
  },
};

/**
 * A variant that matches beneath a class on the root, such as `dark` or `platform-ios`.
 *
 * Tailwind 3 puts an app's `prefix` on every class in a variant's selector, `.tw-dark &`, and the
 * root wears `dark`. On native the prefix is recorded for `flattenTailwind`, which takes it back
 * off. A browser has no such step, so there the class is matched as an attribute, which the prefix
 * leaves alone and which is as specific as a class.
 */
const beneath = (platform, name) => (platform === 'web' ? `[class~="${name}"] &` : `.${name} &`);

/** `web.css`'s root tokens: the browser's own safe-area insets, and a hairline per density. */
const WEB_BASE = {
  ':root': Object.fromEntries(
    Object.values(EDGES).map((edge) => [
      `--safe-area-inset-${edge}`,
      `env(safe-area-inset-${edge}, 0px)`,
    ]),
  ),
  '@media (min-resolution: 2dppx)': { ':root': { '--hairline': '0.5px' } },
  '@media (min-resolution: 3dppx)': { ':root': { '--hairline': '0.33px' } },
};

/** @param {'native' | 'web'} platform */
function presetPlugin(
  platform,
  { addBase, addUtilities, addVariant, config, matchUtilities, theme },
) {
  const states = STATES[platform];
  const on = (selectors) => selectors.map((s) => `&${s}`);
  addVariant('hover', on(states.hover));
  addVariant('press', '&:active');
  addVariant('hovered', on(states.hovered));
  addVariant('focus-visible', on(states['focus-visible']));
  addVariant('focus', on(states.focus));
  addVariant('disabled', on(states.disabled));

  // Tailwind 3 builds `group-*:` and `peer-*:` from the pseudo-class itself rather than from the
  // variants above, so each state is spelt again for an ancestor `.group` and an earlier `.peer`.
  for (const state of ['hover', 'focus', 'focus-visible', 'disabled']) {
    addVariant(
      `group-${state}`,
      states[state].map((s) => `:merge(.group)${s} &`),
    );
    addVariant(
      `peer-${state}`,
      states[state].map((s) => `:merge(.peer)${s} ~ &`),
    );
  }

  // The platform, from a class on the root.
  addVariant('ios', beneath(platform, 'platform-ios'));
  addVariant('android', beneath(platform, 'platform-android'));
  addVariant('web', beneath(platform, 'platform-web'));
  addVariant('native', [beneath(platform, 'platform-ios'), beneath(platform, 'platform-android')]);
  if (platform === 'web') addBase(WEB_BASE);
  else if (config('prefix')) {
    // Read by `flattenTailwind`, which takes the prefix back off the root classes.
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
  // `important: true` makes them important too, and the platform rules still win. A browser has
  // the whole stack, so the web keeps it.
  if (platform === 'native' && firstFamily(theme('fontFamily.mono')) === 'ui-monospace') {
    addUtilities({
      '.font-mono': { 'font-family': 'Courier New' },
      '.platform-ios .font-mono': { 'font-family': 'Menlo' },
      '.platform-android .font-mono': { 'font-family': 'monospace' },
    });
  }
}

/** @param {'native' | 'web'} platform */
function tailwind3Preset(platform) {
  return {
    // A class seeded from the OS, so an app can disagree with it.
    darkMode: ['variant', beneath(platform, 'dark')],
    // A browser reset in terms of `html` and `::before`. None of it means anything on a phone, and
    // in a browser the host's `reset.css` is the reset.
    corePlugins: { preflight: false },
    plugins: [(api) => presetPlugin(platform, api)],
  };
}

module.exports = { tailwind3Preset };
