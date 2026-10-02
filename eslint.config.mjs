import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

/**
 * Three rules earn their place here. The rest is deliberately absent: formatting is not enforced,
 * and stylistic rules are left to review.
 *
 * `@nx/enforce-module-boundaries` turns the layering in docs/ARCHITECTURE.md into something checkable.
 * The engine is framework-agnostic, and without this nothing would say so but a comment: one
 * `import '@angular/core'` in `packages/fabric` would pass every test we have.
 *
 * `complexity` is a brake on sprawl. A function that grows another branch every time a case turns
 * up is how this codebase would rot, and it is the failure mode least visible in review.
 *
 * `CUSTOM_ELEMENTS_SCHEMA` and `NO_ERRORS_SCHEMA` are banned: either one turns template checking
 * off for a whole component, so a misspelt input or a wrong type binds to nothing without a word.
 * An element that needs typing gets a component whose inputs are its props instead.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/*.generated.ts',
      // Scratch apps the tailwind tests make and delete while lint may be walking the same folder.
      '**/.tailwind-*',
      '**/dist/**',
      '.claude/**',
      'examples/*/.expo/**',
      // The published starters. Their files are an app's source, copied verbatim into someone
      // else's project, so this workspace's boundary rules do not apply to them. They are verified
      // by being used: `scripts/verify-publish.mjs` publishes to a local registry, generates an
      // app from each and bundles it, which is a stronger check than linting them in place.
      'template/**',
      // The generators' copies of the template's files, for the same reason. They are an app's
      // source, and a test in each package fails if they stop matching the template's.
      'packages/schematics/files/**',
      'packages/nx/files/**',
      // A library as ng-packagr builds it, kept byte for byte: the tests read what it really emits.
      'packages/integration-tests/fixtures/ng-packagr/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.cjs'],
    languageOptions: { parser: tseslint.parser, sourceType: 'module', ecmaVersion: 2023 },
    plugins: { '@nx': nx },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/^(CUSTOM_ELEMENTS_SCHEMA|NO_ERRORS_SCHEMA)$/]',
          message:
            'Template checking stays on. Give the element a component whose inputs are its props.',
        },
      ],
      '@nx/enforce-module-boundaries': [
        'error',
        {
          // Off: `@ng-native/metro` and `@ng-native/tailwind` ship as the JavaScript they are
          // written in and have nothing to build, so a built package requiring them is correct.
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            {
              // The engine knows nothing about Angular, and nothing about React Native either:
              // the host passes in what it needs.
              sourceTag: 'layer:runtime',
              onlyDependOnLibsWithTags: [],
              bannedExternalImports: ['@angular/*', 'react-native', 'react-native/*'],
            },
            {
              // The build-time half runs in a Metro worker, never on a device. It must not be
              // reachable from anything that ships.
              sourceTag: 'layer:build',
              // Build-time packages may use each other - the Tailwind step chains onto the Metro
              // transformer - but nothing that ships may reach them, which is the half that matters.
              onlyDependOnLibsWithTags: ['layer:build'],
            },
            {
              // Platform capabilities: the keyboard, the screen, the OS, the user's settings.
              // Below the Angular-facing packages because both they and an app need them, and
              // the boundary below forbids those packages from reaching into each other.
              sourceTag: 'layer:device',
              onlyDependOnLibsWithTags: ['layer:runtime'],
              bannedExternalImports: ['lightningcss', '@oxc-angular/*'],
            },
            {
              // The Angular-facing packages sit on the engine, on the platform capabilities, and
              // on Angular. They must not reach into each other: a component should not import
              // the router.
              sourceTag: 'layer:angular',
              onlyDependOnLibsWithTags: ['layer:runtime', 'layer:device'],
              bannedExternalImports: ['lightningcss', '@oxc-angular/*'],
            },
            {
              // A test harness for apps, run by Node and never bundled. The fake Fabric needs the
              // engine's node shapes; `render()` mounts through the platform, the way an app
              // boots; and the runner hooks compile through Metro's transform, so a test runs
              // what the bundle would.
              sourceTag: 'layer:testing',
              onlyDependOnLibsWithTags: ['layer:runtime', 'layer:angular', 'layer:build'],
            },
            {
              // The integration suite mounts real components through the adapter onto the fake
              // Fabric, so it reaches into everything on purpose. That is what makes them
              // integration tests rather than unit tests, and why they are their own project.
              sourceTag: 'layer:tests',
              onlyDependOnLibsWithTags: ['*'],
            },
            {
              // The example app may use everything, which is the point of it.
              sourceTag: 'layer:app',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * The only cross-project imports allowed to stay relative, and each has to be.
     *
     * A fixture is AOT-compiled by `compileFixture` and its imports have to resolve from the
     * generated file, so they must name real source files. And the router and components barrels
     * re-export decorated classes, which Node's type stripping cannot erase, so a test reaching
     * for a decorator-free file has to say which one. Everything else in this project imports
     * through the package entry points, and the rule stays on to keep it that way.
     */
    files: [
      'packages/integration-tests/fixtures/**/*.ts',
      // The renderer benchmark mounts the real components, for the same reason a fixture does.
      'packages/integration-tests/bench/**/*.ts',
      'packages/integration-tests/router-*.test.ts',
      'packages/integration-tests/device.test.ts',
      'packages/integration-tests/icons.test.ts',
      'packages/integration-tests/animation.test.ts',
      'packages/integration-tests/web-animation.test.ts',
      'packages/integration-tests/worklet-style.test.ts',
      'packages/integration-tests/gesture.test.ts',
      'packages/integration-tests/gesture-dispatch.test.ts',
      'packages/integration-tests/worklet-scroll.test.ts',
      'packages/integration-tests/css-index.test.ts',
      'packages/integration-tests/height-index.test.ts',
      'packages/integration-tests/css-scale.test.ts',
      'packages/integration-tests/tailwind.test.ts',
      'packages/integration-tests/tailwind-metro.test.ts',
      // Tests of internals the package entry points do not export, which have no other way in.
      'packages/integration-tests/css-cost.test.ts',
      'packages/integration-tests/css-oracle.test.ts',
      'packages/integration-tests/dev-loading-view.test.ts',
      'packages/integration-tests/device-sources.test.ts',
      'packages/integration-tests/dialogs.test.ts',
      'packages/integration-tests/engine-commit.test.ts',
      'packages/integration-tests/expo.test.ts',
      'packages/integration-tests/fabric-facade.test.ts',
      'packages/integration-tests/host-primitives.test.ts',
      'packages/integration-tests/layout-animation.test.ts',
      'packages/integration-tests/native-props.test.ts',
      'packages/integration-tests/native-state.test.ts',
      'packages/integration-tests/web-parity.test.ts',
      'packages/integration-tests/register-linker.mjs',
      // `@ng-native/web` is `layer:angular` (it depends on nothing but the engine and
      // device capabilities, same as `packages/platform`), and rightly cannot import
      // `@ng-native/components` from its own source. Its own tests are a different matter, the
      // same way `packages/integration-tests`' fixtures above are: proving the seam holds means
      // mounting a real `Pressable`/`ScrollView`
      // through it, in a jsdom environment `packages/integration-tests` does not set up. These
      // fixture files, and the hook registration that makes `node --test` able to compile them,
      // are the same exception for the same reason.
      'packages/web/src/*-app.ts',
      'packages/web/register-linker.mjs',
      // The browser test target, for the same reason and one more. Its fixtures are the `*-app.ts`
      // files already excepted above, and its Vite config imports `@oxc-angular/vite` - which
      // `layer:angular` bans, correctly, for anything that ships. A build config is the one thing
      // in the package that is allowed to know which compiler compiles it, and it is not part of
      // the package's own graph.
      'packages/web/vitest.config.ts',
      'packages/web/browser/**/*.ts',
      // The Vite preset an app's build config imports, for the same reason: it is build tooling
      // shipped beside the package, and no file under `src` imports it.
      'packages/web/vite.mjs',
      // The other way round: `@ng-native/testing`'s own tests import the package by its name,
      // not by relative path, because they stand in for an app's tests and an app has no other
      // way in. A relative import would bypass the `exports` map those tests exist to prove.
      'packages/testing/src/*.test.ts',
    ],
    rules: { '@nx/enforce-module-boundaries': 'off' },
  },
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.cjs'],
    rules: {
      complexity: ['error', { max: 12 }],
    },
  },
);
