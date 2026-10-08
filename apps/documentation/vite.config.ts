/**
 * The documentation site's build.
 *
 * The Angular compiler is `@oxc-angular/vite`, and that choice is load-bearing rather than
 * incidental. This site renders the real `@ng-native/components` straight out of their own
 * source, so whatever compiles the site compiles it too, and only one configuration of one
 * compiler is known to do that here:
 * `emitClassMetadata: false` (see below) is a workaround this repo already needed once, and the
 * alternative toolchain brings problems of its own that reach outside this app.
 *
 * `markdown()` turns `.md` into a module the app can render, `source()` hands a component's own
 * source text to the page that shows it running, and `api()` reads every component, directive and
 * service in the workspace out of its own source so the reference pages cannot drift from the code
 * they describe. `exampleSources()` does the same for the example apps' code browser, reading each
 * app's files out of `examples/`. `angularGuards()`, placed after `angular()`, fails the build on
 * the same confirmed `@oxc-angular/vite` bug `packages/metro/angular-transform.cjs` guards
 * against - see that file for why an unrelated build otherwise picks up a mis-compiled component
 * with no error.
 */
import { angular } from '@oxc-angular/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import url from 'node:url';
import { angularGuards } from './build/angular-guards.ts';
import { api } from './build/api.ts';
import { exampleSources } from './build/example-sources.ts';
import { markdown } from './build/markdown.ts';
import { source } from './build/source.ts';

const dirname = path.dirname(url.fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(dirname, '../..');
const dist = path.resolve(dirname, 'dist');

/**
 * `vite preview`, taught the one lookup Cloudflare Pages does and it does not.
 *
 * `build/prerender.ts` writes each route's snapshot to `dist/<route>.html`, which Pages serves at
 * `/<route>`. Vite's preview server only tries `<route>.html` when the request ends in a slash, so
 * `/packages/components/touch` would land on the SPA fallback - the home page, for every route,
 * which looks exactly like prerendering having silently failed.
 */
function previewPrerendered(): Plugin {
  return {
    name: 'documentation:preview-prerendered',
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [route = '/', search] = (request.url ?? '/').split('?');
        const file = `${route.replace(/\/$/, '')}.html`;
        if (!path.extname(route) && fs.existsSync(path.join(dist, file))) {
          request.url = `${file}${search ? `?${search}` : ''}`;
        }
        next();
      });
    },
  };
}

/**
 * What `public/_headers` has Cloudflare Pages send with `/assets/*`: the course's preview frame is
 * sandboxed into an opaque origin, so everything it loads is a cross-origin request and needs this.
 * See `src/learn/protocol.ts`.
 */
const ASSET_HEADERS = { 'Access-Control-Allow-Origin': '*' };

/**
 * The dev server and `vite preview`, sending `ASSET_HEADERS` as the host does.
 *
 * A middleware rather than `server.headers` and `preview.headers`, for a reason on each side:
 *
 * - In development the frame's modules come from `/src`, `/@fs`, `/@vite` and
 *   `/node_modules/.vite` rather than one directory, so every response gets the header. And
 *   `server.headers` only reaches Vite's own responses, not the component modules the Angular
 *   plugin serves itself, which the frame then fails to load.
 * - `preview.headers` goes on every response and cannot be scoped to a path. The course's
 *   end-to-end tests run against `vite preview`, so it sends the header with `/assets/*` only, as
 *   `public/_headers` does, and a frame that loaded anything from elsewhere fails there too.
 */
function crossOriginAssets(): Plugin {
  const send = (response: ServerResponse) => {
    for (const [name, value] of Object.entries(ASSET_HEADERS)) response.setHeader(name, value);
  };
  return {
    name: 'documentation:cross-origin-assets',
    configureServer(server) {
      server.middlewares.use((_request, response, next) => {
        send(response);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.startsWith('/assets/')) send(response);
        next();
      });
    },
  };
}

export default defineConfig({
  root: dirname,
  // Vite only exposes an env var to `import.meta.env` (and to `%NAME%` substitution in
  // `index.html`) when its name starts with one of these prefixes, precisely so a build cannot
  // leak an arbitrary environment variable into the client bundle by accident. `SITE_URL` is
  // meant to reach the client - `src/site.ts` reads it back as `import.meta.env.SITE_URL` to
  // build canonical and Open Graph URLs - so it is opted in here rather than renamed to
  // `VITE_SITE_URL`, which is not the name a preview-deploy script would already know to set.
  envPrefix: ['VITE_', 'SITE_'],
  server: {
    port: 5201,
    // `build/api.ts` reads every package's TypeScript out of the workspace, and the pages import
    // the module it generates. Vite's dev server refuses to serve a file outside its own root
    // without being told.
    fs: { allow: [workspaceRoot] },
  },
  plugins: [
    previewPrerendered(),
    crossOriginAssets(),
    markdown(),
    api(workspaceRoot),
    source(),
    exampleSources(workspaceRoot),
    angular({
      workspaceRoot,
      zoneless: true,
      // A component that declares itself before a sibling it queries - and reads that sibling back
      // as a value before its own class binding has initialised - throws under real ES class
      // semantics the instant it is imported, because the dev-only `ɵsetClassMetadata` call Angular
      // emits reads it eagerly. This site has not needed the workaround since the component that
      // first hit it was removed, but it costs nothing to keep off in production code either way.
      emitClassMetadata: false,
    }),
    angularGuards(),
    tailwindcss(),
  ],
  optimizeDeps: {
    // `packages/device/src/react-native.ts` guards its `require('react-native')` behind a check
    // that is false in every browser, but a bundler still has to resolve the specifier to build
    // its graph, and React Native's source is Flow - which is why it is also `external` below.
    //
    // `expo` and React Native's dev banner are the same story one level down: `@ng-native/platform`
    // `require`s them from its dev-only reload hook, which the course's preview pulls in through
    // `@ng-native/testing` and a browser never calls. `lightningcss-wasm` loads its own
    // WebAssembly by URL, which pre-bundling would break.
    exclude: ['react-native', 'expo', 'lightningcss-wasm'],
  },
  build: {
    rollupOptions: {
      external: ['react-native', 'expo', /^react-native\//],
      // The site, and the course's preview frame: a page of its own, so that the learner's code,
      // Tailwind's browser build and the phone's platform classes stay out of the lesson page. See
      // `src/learn/preview/frame.ts`.
      input: {
        main: path.resolve(dirname, 'index.html'),
        preview: path.resolve(dirname, 'learn-preview.html'),
      },
    },
  },
});
