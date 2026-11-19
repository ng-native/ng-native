/**
 * Compiles Taiga UI's global theme, which ships as LESS, into `src/theme/taiga-theme.css`.
 *
 * Run it (`pnpm theme`) after changing the `@taiga-ui/styles` version in package.json. It reads
 * the copy installed for this example, and fails rather than writing a theme from a version that
 * is not the one package.json pins.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import less from 'less';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);

const pinned = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).dependencies[
  '@taiga-ui/styles'
];
const installed = require('@taiga-ui/styles/package.json').version;
if (installed !== pinned) {
  throw new Error(
    `@taiga-ui/styles ${installed} is installed, but package.json pins ${pinned}: run pnpm install.`,
  );
}

const entry = require.resolve('@taiga-ui/styles/taiga-ui-theme.less');
// Only the theme: Taiga's other entry, `taiga-ui-fonts.less`, imports Manrope from Google Fonts,
// and the app bundles the face itself instead (`src/theme/manrope.css`).
const { css } = await less.render(readFileSync(entry, 'utf8'), {
  filename: entry,
  quietDeprecations: true,
});

const header =
  `/* Taiga UI's theme, @taiga-ui/styles ${installed}/taiga-ui-theme.less compiled by ` +
  `scripts/build-theme.mjs. Do not edit: run pnpm theme. */\n`;
writeFileSync(new URL('src/theme/taiga-theme.css', root), header + css);
console.log(`src/theme/taiga-theme.css: @taiga-ui/styles ${installed}`);
