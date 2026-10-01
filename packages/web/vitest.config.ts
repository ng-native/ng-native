/**
 * The browser test target, and the counterpart to `package.json`'s `test` script rather than a
 * replacement for it.
 *
 * `src/*.test.ts` runs under `node --test` in jsdom and is the suite for anything a DOM can
 * answer without a layout engine: what is in the tree, what a press does, what a model holds.
 * jsdom does no layout at all and loads no stylesheet, so an entire class of claim is
 * structurally out of its reach - a popover's placement, an accordion's animated height, a
 * focus ring, a `md:` breakpoint. `browser/*.test.ts` is that class, in a real Chromium, and is
 * deliberately small: it exists to prove the things the other suite has to write down as
 * unproven, not to re-prove what it already proves faster.
 *
 * The Vite half is `examples/web/vite.config.ts` almost verbatim, and for the same reasons - read
 * that file for the full case behind each option, in particular why `emitClassMetadata` is off
 * and why `react-native` is excluded from dependency optimization. The one difference is
 * `@source` in `browser/styles.css` rather than this file: the fixtures under `src/` are outside
 * every directory Tailwind's automatic detection would reach on its own.
 */
import { playwright } from '@vitest/browser-playwright';
import { angular } from '@oxc-angular/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import url from 'node:url';

const dirname = path.dirname(url.fileURLToPath(import.meta.url));

/*
 * What a test cannot do from inside the page: hold a real mouse button down, which is the only
 * thing that makes Chromium match `:active` (a dispatched `pointerdown` does not), emulate the
 * OS colour scheme and the screen's pixel density, and run Tailwind 3's CLI. They run in Node,
 * beside the page, and `browser/boot.ts` declares them.
 */
const pointerDown: BrowserCommand<[selector: string]> = async (context, selector) => {
  await context.iframe.locator(selector).hover();
  await context.page.mouse.down();
};
const pointerUp: BrowserCommand<[]> = async (context) => {
  await context.page.mouse.up();
};
const emulateColorScheme: BrowserCommand<[scheme: 'light' | 'dark']> = async (context, scheme) => {
  await context.page.emulateMedia({ colorScheme: scheme });
};

/** Emulates a screen of `scale` device pixels per CSS pixel, which `min-resolution` reads. */
const deviceScale: BrowserCommand<[scale: number]> = async (context, scale) => {
  const cdp = await context.page.context().newCDPSession(context.page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 0,
    height: 0,
    deviceScaleFactor: scale,
    mobile: false,
  });
};

/**
 * The Tailwind 3 web preset's sheet for `classes` with `prefix`, from Tailwind 3's own CLI. Built
 * here rather than by a Vite plugin, since the suite's Vite build is Tailwind 4's.
 */
const tailwind3: BrowserCommand<[classes: string, prefix: string]> = (_, classes, prefix) => {
  const require = createRequire(import.meta.url);
  const preset = require.resolve('@ng-native/tailwind/web-preset.cjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'tailwind-3-web-'));
  try {
    const config = { prefix, content: [{ raw: classes }] };
    writeFileSync(
      path.join(dir, 'tailwind.config.js'),
      `module.exports = { presets: [require(${JSON.stringify(preset)})], ...${JSON.stringify(config)} };`,
    );
    writeFileSync(path.join(dir, 'in.css'), '@tailwind base;\n@tailwind utilities;\n');
    const cli = require.resolve('tailwindcss-v3/lib/cli.js');
    execFileSync(
      process.execPath,
      [cli, '-c', 'tailwind.config.js', '-i', 'in.css', '-o', 'out.css'],
      {
        cwd: dir,
        stdio: 'pipe',
      },
    );
    return readFileSync(path.join(dir, 'out.css'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export default defineConfig({
  plugins: [
    angular({
      workspaceRoot: path.resolve(dirname, '../..'),
      zoneless: true,
      emitClassMetadata: false,
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ['react-native'],
  },
  test: {
    include: ['browser/*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // One instance, one browser process. Chromium only: what this suite asserts is layout and
      // cascade, and the engine-specific differences a second browser would find are a question
      // about this project's browser support matrix rather than about whether the library works.
      instances: [{ browser: 'chromium' }],
      // Every test in here drives a viewport of its own size, so a shared default that any of
      // them could silently inherit would be a trap. This is the size a test starts from, and
      // `page.viewport()` is how one that cares says so.
      viewport: { width: 1200, height: 800 },
      commands: { pointerDown, pointerUp, emulateColorScheme, deviceScale, tailwind3 },
    },

    /*
     * Coverage, off unless `--coverage` asks for it.
     *
     * This suite drives a real Chromium, so instrumenting it costs more than the tests themselves
     * take to run. `scripts/coverage.mjs` turns it on; an ordinary `pnpm test:browser` should not
     * pay for a report nobody asked for.
     *
     * v8 rather than istanbul because the browser already collects v8 coverage natively, and
     * because istanbul would mean a Babel pass over source this project deliberately keeps away
     * from Babel. The report is written where the other two suites write theirs, so the merge in
     * `scripts/coverage.mjs` finds all three in one directory.
     */
    coverage: {
      provider: 'v8',
      reporter: ['lcovonly'],
      reportsDirectory: path.resolve(dirname, '../../coverage/browser'),
      // Only this workspace's own source. Without `include`, v8 reports every dependency the
      // browser happened to evaluate, which is most of Angular.
      include: ['src/**/*.ts'],
      exclude: ['**/*.generated.ts', '**/*.test.ts', '**/fixtures/**', '**/*-app.ts'],
    },
  },
});
