# AGENTS.md

This is the Angular Native workspace: Angular components rendering real native iOS and Android
views on React Native's Fabric renderer, with React never in the render path. It is a pnpm and Nx
monorepo of the `@ng-native/*` packages, their examples, the starter template and the
documentation site.

`template/AGENTS.md` is a different file: it ships to apps generated from the template and
describes using the packages, not working on them.

## Read before a change

- [ARCHITECTURE.md](ARCHITECTURE.md): the rules the design depends on. A change that would break
  one needs a different approach, not an exception.
- [CONTEXT.md](CONTEXT.md): the project's vocabulary. Use its terms (engine, platform, node,
  commit, sheet, screen, primitive) and avoid the words it lists against each.
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, where tests live, and what a pull request needs.
- [.claude/rules/angular.md](.claude/rules/angular.md): the Angular style this repo follows.

## Commands

```sh
pnpm install
pnpm lint                         # through Nx, never bare eslint
pnpm typecheck
pnpm test
pnpm affected                     # lint, typecheck and test for what a change can have broken
pnpm format:check
pnpm nx run <project>:<target>    # one project, e.g. @ng-native/integration-tests:test
pnpm export                       # release bundles of every example, after CSS or Metro changes
```

## Rules that are easy to get wrong

- **Lint only through Nx.** `@nx/enforce-module-boundaries` needs the project graph and silently
  enforces nothing when `eslint` runs on its own.
- **Respect the layer tags in `eslint.config.mjs`.** `@ng-native/fabric` never imports Angular or
  React Native; Angular-specific code lives in `@ng-native/platform` and above.
- **Change the CSS engine test-first.** It drops what it cannot express with a warning, or with
  none at all after a regression, so a test pinning the expected behavior comes before the change
  in `packages/fabric` or `packages/metro`.
- **Element names in templates are lowercase.** `<View>` compiles to an empty template on a green
  build.
- **One copy of `@angular/core` and of each native module.** A second copy fails at runtime far
  from the cause. `pnpm-workspace.yaml` pins the native modules with `overrides` to the Expo SDK's
  versions.
- **Add a version plan** in `.nx/version-plans/` (`npx nx release plan`) for a change someone using
  the packages would notice.
- **Commit messages are sentence-case summaries,** with no `feat:` or `fix:` prefix.
