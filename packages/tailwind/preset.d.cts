/**
 * The native preset for Tailwind 3, for a `tailwind.config.ts`. Spelt out rather than typed as
 * `Config` from `tailwindcss`, so it holds whichever major of Tailwind the import resolves to.
 */
declare const preset: {
  darkMode: ['variant', string];
  corePlugins: { preflight: false };
  plugins: ((api: unknown) => void)[];
};
export = preset;
