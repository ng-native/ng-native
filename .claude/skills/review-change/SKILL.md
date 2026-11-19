---
name: review-change
description: Review a pull request, branch or working diff in this repo the way its history says it needs reviewing - score its risk and blast radius per platform, check the areas that have broken before (CSS against Chrome, invalidation, absent native modules, async ordering, generators on real workspaces), make sure tests bite and coverage holds, that breaking changes have a version plan and a migration, that new APIs match their siblings and React Native or Expo, and that nothing duplicates code the repo already has. Every finding is verified and graded low, medium, high or critical. Use when asked to review a PR, a branch or a diff, or before opening or merging one.
---

# Review a change

This is a procedure, not a reference. Invoking the skill only loads it: the review is the steps
below, run in order, and it is not done until the report in step 6 ends with its done list. A
read-through of the diff and "looks fine" is not this review, and a report that says the skill was
invoked without that list has not run it.

Read [AGENTS.md](../../../AGENTS.md), [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md),
[CONTEXT.md](../../../docs/CONTEXT.md) and [.claude/rules/angular.md](../../rules/angular.md) first. A
fresh worktree has no `node_modules`: run `pnpm install` before running anything.

## 1. Get the change, cheaply

GitHub rate-limits this repo's automation, so fetch once:

- A PR: `gh pr view <n> --json title,body,baseRefName,headRefName,files` and `gh pr diff <n>`. Check
  it out with `gh pr checkout <n>` only when you will run tests.
- A branch: `git diff origin/main...HEAD`. A working tree: `git diff HEAD`.

Read every changed file in full, not just the hunks, and the callers of anything whose behaviour
changed (`git grep`). Read the PR body: what it claims is what you check.

Review the whole of each touched function, and its siblings (the other branch of the same switch,
the matching `begin`/`end`, create beside update), not only the changed lines: a fix to one
branch that leaves its sibling is what the next bot round finds.

Run it again, on the new diff only, before each push that follows:

- **A fix for a finding.** The fix is a change of its own, and the next bot round often lands in
  it: a guard that restores `false` instead of the earlier value, a deferred value that loses its
  selection, an idle callback holding a raw pointer. Check it against every section below, not just
  the finding it answers.
- **A merge** from main or the parent branch of a stack (`git diff <head before the merge>..HEAD`).
  A merge brings code this branch never built with (a test target missing the rpath main's change
  added), and each push is another bot review round, so merge and fix in one push.

## 2. Score the risk

Before hunting for bugs, say what a mistake here could break and for whom.

| Surface                         | Touched by                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------ |
| iOS (16.4+)                     | `fabric`, `platform`, `components`, `router`, `expo`, `device`, native targets |
| Android (minSdk 24)             | the same, plus anything with an Android-only branch or Compose view            |
| Web host                        | `web`, the web preset in `tailwind`, `*.web.*` files, `browser` exports        |
| macOS desktop                   | `packages/desktop/native/core` and `appkit`, `desktop/bin`                     |
| Linux desktop (GTK 4)           | `packages/desktop/native/core` and `gtk`, `desktop/bin`, Linux packaging       |
| Build (Metro, Tailwind, Hermes) | `metro`, `tailwind`, the Angular transform, release bundles                    |
| Workspaces (generators, update) | `nx`, `schematics`, `migrate`, `template`, `package.json` exports and peers    |
| Repo only                       | tests, CI, scripts, `.claude`, `docs/`                                         |

For each surface the change reaches, give a **blast radius**: `none`, `narrow` (one API or one
property, opt-in), `wide` (every app using a package, or a default) or `all` (every app: the engine
commit, the CSS compiler, `mount`, the template, a generator's default output). Then an overall
**risk**: low, medium, high or critical, from the widest radius and how silent a failure would be.
A change that can fail silently (the CSS engine dropping a declaration, `<View>` compiling to an
empty template, a migration skipping a file) rates one level higher than its radius alone.

Platforms are reviewed separately: a change can be low risk on iOS and high on Android.

## 3. Check what has broken before

Every item here is a class of bug a past review caught. Check each one that applies to the diff.

**CSS compiler and engine (`packages/metro/css`, `packages/fabric`).** Chrome is the reference, not
intuition. Check:

- both paths: a declaration in a sheet and the same value set on an element (inline or bound), and
  that they agree;
- `var()` fallbacks, alias chains (`--a: var(--b)`), derived tokens settled in any declaration order,
  cycles, and a token that is unset;
- `calc()` keeping its dimension (a unitless number is not a length) through nested `calc()`;
- CSS whitespace, not `trim()` (U+00A0 is not whitespace), escapes and line continuations in strings;
- shorthands: a duplicate part invalidates the declaration, an omitted part resets to its initial
  value, a later longhand still wins, and `!important` beats a normal declaration;
- out-of-range values clamped the way CSS clamps them;
- inline logical sides (`Start`/`End`, `inline-start`/`inline-end`) resolved by the box's direction,
  while block sides stay top and bottom, with a right-to-left case and a physical and logical side set together, and aliases Yoga reads (`marginHorizontal`,
  `paddingStart`) counted as Yoga counts them;
- every alternative of a selector the change supports (`:is()` and `:where()`, each branch of a list,
  `>` as well as a descendant combinator);
- a value removed on an update sent as `null`, since JSI drops `undefined` and the old native value stays,
  and no `??` that turns an intentional `null` (a paint of `none`) into `undefined`;
- a refusal is a warning, never a silent drop. Test-first is required here: the test pinning the
  behaviour must exist and fail without the change, with a Chrome oracle row where one applies.

**Derived and cached state.** Most "major" findings were stale state. For every cache, registry,
memo or `computed` the change adds or relies on, ask what invalidates it, and check both directions:
the input changes, and the input goes away. Past cases: a text prop not marked dirty when a child
came and went, keyframes and global sheets never removed on HMR, scroll tracks keeping an old
inherited colour, a font face added after a text resolved, an angle kept after its hinge vanished,
a list warning not rechecked when `items` changed. Tests should add then remove.

Then list every way into the state the change touches, and check the change on each. The fix that
handles one path and misses its sibling is the most common finding after stale state: host sheets
not watched where global and component sheets were, a guard on clone but not on create, a sheet
replaced but not rescanned, an assertion run on the build but not on a hot reload, the first of two
duplicate font faces kept where Expo registers the last. A long-lived map keyed by something that comes and
goes (rows, cells, names) needs eviction, or it grows for the life of the app; one discarded with its owner
does not.

**Native modules and devices (`packages/expo`, `packages/device`).**

- The module absent (Expo Go, web, Node tests), and the module present with a method absent: call
  methods with `?.()`, and never `TurboModuleRegistry.getEnforcing` at import time.
- A stand-in returned when the module is absent has every method callers use.
- Validation runs before the availability check, so Node tests still see errors.
- Debug versus release: nothing dev-only (reload, Fast Refresh, `ngDevMode` branches) reachable in a
  release build.
- OS floors: iOS 16.4 and Android API 24. An API newer than the floor is gated, and the docs say so.
- Permissions: denied, restricted and never-asked all answer, and none throw.

**Desktop hosts (`packages/desktop/native`).** Check:

- every `g_signal_connect`, idle or timeout source, and callback that captures `this` or a raw
  pointer is disconnected or cancelled when its widget, window or owner goes, on every way it goes
  (close, destroy, unmount, reload, a widget replaced by a role change);
- GTK work from another thread is queued with `g_idle_add`, never `g_main_context_invoke`, which
  runs the function on the calling thread when the context is free;
- a props update applies only what changed since the props last applied, so an unrelated prop does
  not reset native state (a switch's slide, a calendar's browsed month, typed text), and state sent
  back to Fabric is compared with the state the update is applied to, not the mounted one;
- a value held back (during composition, before a mount, until layout) keeps the event count and
  selection it came with, and only fresher props or commands replace it;
- a replaced widget gets everything the old one had: props, signal handlers, scale, focus without
  selecting its text, and each child's `child-visible`, which `gtk_widget_unparent` resets;
- a cairo surface or matrix, and any library call that can fail, has its status checked, on each
  of the sibling paths (a filter and a mask) and not only the one the change adds;
- the floors the build accepts (GTK 4.10, libadwaita 1.4, EL9's versions): a call or behaviour
  newer than the floor is gated, checked in GTK's or libadwaita's source at that tag, and the
  version plan names the version. A test that returns early on the version CI has checks nothing
  there;
- a loop or queue fed by a peer (WebSocket frames, pings, retries of a failed load) has a bound.

**Async ordering and errors.** Two events before the next change-detection pass (a signal `set`
keeps only the last, so queue deliveries), a value that changes while a sync awaits (write the
latest after it), a session not yet active, a rejected promise with no handler, one throwing
listener or `ngOnDestroy` stopping the rest. Each listener and teardown is isolated, and a failure
reaches `ErrorHandler`.

**Components, router and accessibility.** Compare with React Native's own source in `node_modules`
for the version the repo pins (each of `Pressable`, `TouchableOpacity`, `Text`, `Switch` differs),
and with `react-native-screens` for navigation. Roles, disabled state and what a screen reader
announces should match React Native. Divergence that makes one platform refuse more than the other
is a finding.

**Generators, migrations and installs (`nx`, `schematics`, `migrate`, `template`).** Real workspaces
are messier than the fixture: `angular.json` with comments and trailing commas (use `tree.readJson`),
YAML edited by structure not by text, `"type": "module"` packages, `options.commands` arrays,
`extends` and path aliases inherited from a base tsconfig, semver ranges with prerelease suffixes,
identifiers that are Kotlin or Java keywords, npm, yarn and bun as well as pnpm, and running the
generator twice. Migrations must respect scope: a name shadowed by a local declaration or a template
`@let` is not rewritten.

**Packaging.** Export-map condition order (`browser` before `types` when the types differ), an
optional peer that leaks into published `.d.ts`, a dependency the package uses but does not declare,
a second copy of `@angular/core` or a native module.

**Scripts and CI.** Fail closed: a failed `gh` call, a truncated page (`--paginate`, or GitHub's 300
and 3,000-file caps) or a rate limit must never read as "nothing to do". Bind merges to the checked
head SHA. Concurrency groups must not let one event cancel another's run.

A spawned process handles its `error` event and is waited for (`close`, not just `exit`) before its
state is removed. When it is stopped with what it started, it is spawned `detached` so it leads its
own process group, then sent SIGTERM to that group and, only if it is still running after a bounded
wait, SIGKILL: a child spawned without `detached` shares the parent's group, so signalling the group
would stop the parent. Output is split into lines across chunks. A path with spaces is quoted in every generated
shell, CMake or spec line, a value written into metadata is validated whole (a newline, `MIT AND`),
and a generated name is checked against the format's limit (ustar's 100 bytes).

**Docs.** Every claim is checked against the code: docs that overstate (say "every" when the code
covers some), drift from what the code does, or leave out a platform qualifier were the most common
documentation findings. A version plan is docs too and draws the same findings, more than any other
file in a PR: an overstated claim, a missing iOS or Android version, a sentence that is hard to parse.
So check it sentence by sentence: name the line of code that makes each one true and the condition
it holds under (a libadwaita version, a resizable window, `expo.icon` set, a signing key), and add
that condition to the sentence. Its first body line becomes the changelog bullet, so it is one
sentence with every detail below it.
A code sample leaves state right when a call fails (a flag reset in `finally`) and has its imports.
Docs describe present behaviour, in [CONTEXT.md](../../../docs/CONTEXT.md)'s
words. A code sample in docs is covered by `docs-samples.test.ts`.

## 4. Check the cross-cutting rules

**Tests bite.** For each fix or behaviour, revert just the change and run its test: it must fail, for
that reason. Reject tests that cannot fail:

- the assertion is satisfied without the code under test (a single token excused by another rule,
  an object compared with itself, a value no input can change);
- the test bypasses the default path it claims to cover (calls a helper the default would call);
- the title promises a case the body never exercises;
- tests sharing mutable state that only pass in file order;
- an implementation detail is asserted where the committed props or rendered output would do;
- only a warning is asserted, so code that warns and still applies the rule passes;
- the case runs in one mode only: left to right, streaming off, the first render but not an update;
- the fixture lacks what makes the case (an image with no intrinsic size, a match that only comes
  through another alternative);
- a wall-clock threshold (a 250 ms cutoff) that a busy CI worker misses, or a wait for a number of
  loop iterations or a fixed queue size instead of for the condition;
- a result that depends on the machine: the locale (`localeCompare`, `%.3f`), a proxy, `GDK_SCALE`,
  a temp path read as a regular expression, a Flatpak or portal session, PID 1 in a container;
- a comment or title describing a different binding or case than the body.

Then mutate the change one line at a time (negate a condition, delete a side effect or guard, move a
boundary) and rerun its test file; a mutation that survives is an assertion missing, or a line that is
not needed.

Tests that change globals, temp directories, CDP sessions or registered names restore them in
`finally`. In C++ a failed `REQUIRE` throws, so a log handler, a fixture's child process or a
callback's captured locals are released by a destructor, and recorders are declared before the
network or loop that calls them. Run `pnpm coverage` (95% floor) when product code changed.

**No regressions.** `pnpm affected` for lint, typecheck and test. For the CSS engine, also the Chrome
oracle corpus and both Tailwind sweeps; for Metro, CSS or example styles, `pnpm export`. Read each
fixture or snapshot change in the diff: every changed line is a behaviour change that needs a reason.

**Performance.** The engine runs per commit and the CSS engine per node, so look for work added on
those paths: allocation per commit, a walk of the whole tree, a style resolve that no longer
short-circuits, a commit when nothing changed (at most one per change-detection pass). Check the cost
against input size too: a walk to the root for each of several nodes (quadratic in depth), each item
rescanning the ones before it, a streamed chunk that re-reads everything that came before. Run
`pnpm --filter @ng-native/integration-tests bench` (or `bench:tailwind`, `bench:screens`) on main and
on the branch when the engine, CSS or components changed, and report both numbers. A new runtime
dependency, or dev-only code not behind `ngDevMode`, is bundle size on every app.

**Breaking changes.** A change someone using the packages would notice needs a version plan: removed
or renamed exports, inputs, outputs or element names, a changed default, different CSS output,
different generated files, different announcements or query results. Under `0.x` a breaking change is
`minor`, and the plan says plainly what breaks and what to do. Anything else, an addition included, is
`patch`; a `minor` plan for an addition is a finding. When the change an app must make is
mechanical (a moved import, a renamed member, a method that became a property), it needs a migration
in `packages/migrate`, registered in all three `migrations.json` files at the release version and
tested with `acrossAdapters`; the plan names it and links Updating an app. When it cannot be
automated, the migration leaves a note with the file and line. A version plan has no heading and its
first line is one unwrapped sentence; never ask for a heading.

**Reuse before adding.** For every new helper, check the repo already lacks it: `git grep` for the
operation, not the name (parsing a CSS token, resolving a package root, reading a JSONC file, a
stand-in for an absent module, temp-directory cleanup in tests). A second copy of an existing helper
is a finding even when the copy is correct.

**Slop and simplicity.** Findings, each with what to cut: comments that narrate the code or the
change; defensive code for states the types rule out; a `try`/`catch` that swallows; an option,
parameter or abstraction with one caller and no second in sight; a wrapper that only forwards;
re-implemented stdlib or Angular (`computed`, `linkedSignal`, `DestroyRef`); names outside the
CONTEXT.md vocabulary; anything the Angular rules forbid (decorators, `standalone: true`, explicit
`OnPush`, `@HostBinding`, constructor injection).

**API consistency.** A new public API is compared with its closest siblings in the same package and
should read as one of them: signals for state (`available`, `error`), the same shape for permissions,
stand-ins and errors routed to `ErrorHandler`, kebab-case lowercase element names, `input()` names
that match React Native's prop where one exists. Then compare it with the React Native or Expo
equivalent. A divergence must be deliberate and documented; an accidental one (a different default,
a missing platform, an option Expo has that this lacks for no reason) is a finding.

**Security.** Shell commands built from input (quote, or pass through variables), secrets in logs or
fixtures, `eval` or `new Function` (Hermes has no local `eval`), and URL or deep-link input trusted
without checking.

## 5. Verify every finding

A finding is reported only when it names a concrete input and the wrong result. Then verify it:

- **Confirmed:** reproduced, by a failing test or script, by running the tool, or by quoting the
  line of the reference source (Chrome's result, React Native's or Expo's source in `node_modules`)
  that contradicts the change.
- **Plausible:** the reasoning holds but could not be reproduced here (device-only, needs a release
  build). Say what would confirm it. A device-only finding can often be confirmed on a simulator or
  emulator of your own; [fix-issue's devices.md](../fix-issue/devices.md) has the commands.

Drop anything that is neither. Before reporting, try to argue each finding away: is the case
reachable from public API, is it already handled elsewhere, does the repo deliberately diverge
(version plans without headings, `npx expo install` in user-facing setup instructions, behaviour
matching React Native over the web)?

For a large diff, at most three `sonnet` agents can verify findings in parallel, one area each. Do
the review itself directly.

## 6. Grade and report

| Severity | Meaning                                                                                                                                                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| critical | A crash, a broken build or release, data loss, a security hole, or an architecture rule broken, on a supported platform in a common path.                                                                              |
| high     | Wrong behaviour in a common path, a regression of shipped behaviour, a breaking change without a version plan or migration, a test that cannot fail guarding the change.                                               |
| medium   | Wrong behaviour in an edge case, a platform or OS version not handled, a measurable performance regression, missing coverage for a branch, a stale cache on a less common path, an API inconsistent with its siblings. |
| low      | Docs wording or accuracy in a corner, naming, slop, duplication of a small helper, a missing test for a trivial branch.                                                                                                |

Report, in this order:

1. **Risk:** overall level and one line on why, then each touched surface with its blast radius.
2. **Findings**, most severe first. Each: severity, confirmed or plausible, `file:line`, the input
   and wrong result, how it was verified, and the fix in one line.
3. **Checks run** and their results, including bench numbers and which tests were reverted to prove
   they bite. Say plainly what was not run.
4. **Version plan and migration:** present and right, missing, or not needed, with the reason.
5. **Done:** one line each, with what was run or read, or "not run" and why:
   - every changed file read in full, and each touched function whole;
   - each section of steps 3 and 4 that applies, named, and the ones skipped as not applying;
   - each test reverted to prove it bites, by name;
   - `pnpm affected` (and coverage, bench or the native suites the change needs);
   - each version-plan sentence checked against the code;
   - for a fix or a merge, the rerun on its own diff.

Post to the PR only when asked. No em-dashes, and no AI attribution, in anything posted.
