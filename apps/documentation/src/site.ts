/**
 * The constants every page's SEO tags are built from.
 *
 * `SITE_URL` has to be known in two runtimes that do not share a module graph: the browser
 * bundle, where `import.meta.env.SITE_URL` is a string Vite inlines at build time (see
 * `vite.config.ts`'s `envPrefix`), and `build/prerender.ts`, a plain Node script Vite never
 * touches, where the same override arrives as `process.env.SITE_URL`. Neither global exists in
 * the other runtime - `process` is undefined in a browser and `import.meta.env` is undefined
 * outside a Vite build - so this file guards for the one it is not in rather than picking a
 * runtime and breaking the other. No trailing slash, so every caller appends its own path and
 * gets exactly one slash between the two.
 */
const fromImportMeta: string | undefined =
  typeof import.meta.env !== 'undefined' ? import.meta.env.SITE_URL : undefined;
const fromProcess: string | undefined =
  typeof process !== 'undefined' && process.env ? process.env.SITE_URL : undefined;

export const SITE_URL = (fromImportMeta ?? fromProcess ?? 'https://ng-native.com').replace(
  /\/+$/,
  '',
);

export const SITE_NAME = 'Angular Native';

export const DEFAULT_DESCRIPTION =
  'Angular components rendering real native views on iOS, Android, macOS and Linux, with React never in the render path.';

export const OG_IMAGE = '/og.png';

export const GITHUB_REPO = 'https://github.com/ng-native/ng-native';

/** Where sponsorship goes: GitHub Sponsors, which is also the repository's Sponsor button. */
export const GITHUB_SPONSORS = 'https://github.com/sponsors/ashley-hunter';

/**
 * Coralogix, which maintains the project, tagged so its analytics can tell a visit came from here.
 * The home page, for links that name the company.
 */
export const CORALOGIX_URL =
  'https://coralogix.com/?utm_source=ng-native&utm_medium=referral&utm_campaign=ng-native';

/** Coralogix's Real User Monitoring page, for links about monitoring an app. */
export const CORALOGIX_RUM_URL =
  'https://coralogix.com/platform/rum/?utm_source=ng-native&utm_medium=referral&utm_campaign=ng-native';

/** `/packages/testing/api` -> `https://ng-native.com/packages/testing/api`, `/` -> the bare origin plus one slash. */
export function urlFor(path: string): string {
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}
