---
name: fix-issue
description: Take one GitHub issue from report to merged-ready PR - verify the report without trusting it, reproduce it, write a failing test, make the minimal fix, prove the test bites, run the checks, review the diff adversarially, and open the PR. Also covers answering review comments and CI failures on that PR. Use when asked to fix, work on, or pick up an issue, or to address review comments or a failing check on an issue's PR.
---

# Fix an issue

One issue, end to end. Read [AGENTS.md](../../../AGENTS.md), [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md),
[CONTEXT.md](../../../docs/CONTEXT.md), [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
[.claude/rules/angular.md](../../rules/angular.md) first.
A fresh worktree has no `node_modules`, so run `pnpm install` before anything else.

## 1. Verify the report

Read it with `gh issue view <n> -R ng-native/ng-native`, then check every claim against the code. Reports
are often partly wrong: the symptom is real but the cause, the scope, the repro or the suggested fix is not.
Record what is right, what is wrong, and the evidence for each.

Check against the reference the package follows, not against the report:

- **CSS (compiler and engine):** what Chrome does. The repo has a Chrome oracle
  (`packages/integration-tests/fixtures/css-oracle-cases.ts` and its generator).
- **Components and accessibility:** React Native's own source in `node_modules` for the version in use,
  per component, since `Pressable`, `TouchableOpacity`, `Text` and `Switch` differ.
- **Nx, Metro and installs:** the real tools, at the versions the reporter used where it matters.

If the report is wrong or already fixed, stop: no PR. Report the evidence. Commenting on or closing the issue
is for whoever owns the batch to decide.

## 2. Reproduce it

Reproduce before changing anything, and say how.

- **Most bugs:** a failing test in `packages/integration-tests`. `web`, `testing`, `nx` and `schematics`
  keep their tests next to the code.
- **Install and tooling bugs:** a scratch workspace in `/tmp` that mirrors what the generator writes. Use
  `--ignore-scripts`, run one install at a time, and repeat the install order users hit (app first, library
  added later). A clean one-step install can hide the bug. Resolve modules with the real resolver (Metro's
  `DependencyGraph`, Vite's `resolveId`) rather than reasoning about folder names. Delete the workspace
  afterwards.
- **Device-only claims:** see "Devices" below. Settle them from the code when you can.

## 3. Write the failing test

The test fails on current code, for the reason the issue describes. A test that fails for another reason proves
nothing.

- The CSS compiler and engine fail silently, so they are strictly test-first.
- A custom-property value has two paths, a stylesheet and a value set on an element. Test both, with a parity
  row for each shape, and use Chrome's value as the expected one.
- A test that reads an implementation detail (such as a stored declaration) breaks when that detail changes.
  Compare what renders instead: an element styled the same way by a plain class, or the committed props.

## 4. Make the minimal fix

Fix the cause in the right layer, in the surrounding style, with no speculative abstraction. Prefer an existing
seam (an option the code already takes, a shared helper, the machinery an earlier fix added) to a new one.

When the fix is a real design choice (two layers it could live in, a public API or output change, a behaviour
that contradicts the docs), stop and put the options to whoever owns the batch, with a recommendation. Keep
prototyping the recommended one while you wait.

A test that pinned the old behaviour may need to change. Only change it with evidence that the new behaviour
is right, and say so in the PR.

## 5. Prove the test bites

With the fix in place, the new test passes. Revert just the fix and confirm the test fails again for the same
reason. Then restore it. Report both results.

## 6. Run the checks

- Only through Nx, and only for the affected projects:
  `NX_DAEMON=false NX_PARALLEL=1 pnpm nx run <project>:test|lint|typecheck`. Bare `eslint` skips the module
  boundaries.
- `pnpm format:check`.
- **CSS changes:** also run the CSS corpus against the Chrome oracle, both Tailwind sweeps, and
  `bench:tailwind` before and after. Accept a fixture or oracle change only when it is the fix working and
  matches Chrome, and explain it.
- **Product code:** run `pnpm coverage` when coverage could drop below the floor.

## 7. Review your own diff adversarially

Try to break it: runtime toggles in both directions, inputs set together or disagreeing, inheritance, theme
switches, cycles, invalid values, other package managers (npm, yarn, bun, pnpm 11 and 12), integrated Nx
workspaces, re-running a generator, Tailwind 3 and 4, the web host, what screen readers announce and what
`getByRole` finds, the docs, and cost per commit.

Fix the real findings, each with a test. Anything outside the issue goes in the PR as a follow-up rather than
into the diff.

## 8. Version plan

Add one when someone using the packages would notice the change: `npx nx release plan`, or by hand in
`.nx/version-plans/` (the format is in [docs/RELEASING.md](../../../docs/RELEASING.md)). The body's first
line becomes the changelog bullet, so make it one whole, unwrapped summary sentence, with detail below. Plans
have no heading. Say plainly when output, announcements, query results or types change.

## 9. Open the PR

- Branch from the latest main: `git fetch origin && git switch -c fix/<slug> origin/main`.
- Commit with a sentence-case summary: no `feat:`/`fix:` prefix, no co-author trailer.
- Before pushing, check that no release is running. A merge while a release runs breaks its push.
  `gh api 'repos/ng-native/ng-native/actions/workflows/release.yml/runs?per_page=1' --jq '.workflow_runs[0].status'`
  must print `completed`.
- Push, then open the PR. `gh pr create` uses GraphQL. When that limit is spent, use REST:
  `gh api repos/ng-native/ng-native/pulls -f title=... -f head=... -f base=main -f body=...`.
- The body covers the cause, the fix, how it was verified, and anything left as a follow-up. It says
  `Closes #<n>`. No AI attribution anywhere.
- Never merge your own PR.

Two issues that share one fix can share a PR. A PR that needs another merged first is stacked (`--base`
on that branch) and says so.

## Review comments and CI failures

**Review comments.** Validate each one; a reviewer can be wrong. When it is right, fix it test-first, push,
reply with what changed, and resolve the thread. When it is wrong, reply with the evidence and resolve it.
Resolving a thread needs GraphQL (`resolveReviewThread`); REST can reply but not resolve.

A request that recurs and is wrong: version plans do not take a heading. `docs/RELEASING.md` shows none,
and the body becomes the changelog bullet.

**CI failures.** Find out whether the PR caused the failure before re-running anything.

- Read the failing job's log.
- Reproduce the failure locally on the branch, and on main too.
- Prove whether the changed code is reached. For example, make it throw on every call and see if the test
  still passes.

If the PR caused it, fix it test-first. If the failure is timing or environment (a real-clock test, a slow CI
simulator), say so with that evidence and leave the test alone. A flake that repeats deserves its own issue.

**When a stacked base merges.** A squash merge leaves the stacked PR conflicting. Rebase just its own commits,
`git rebase --onto origin/main <old base tip>`, confirm its own diff is unchanged, force-push with
`--force-with-lease`, and remove the "stacked" note from the body.

## Devices

A native build or simulator is heavy.

- Run one at a time, machine-wide, under a shared lock: `mkdir /tmp/ngn-device.lock` fails while another
  agent holds it, so retry every minute. `rmdir` it when done, even on failure.
- Prefer Expo Go on the simulator to a native build when it covers the case.
- Gradle needs `--no-daemon`.
- Shut the simulator, emulator and Metro down afterwards.
- Screenshots go in the PR. `gh` cannot attach images, so give their paths or the measured values.

## Writing

No em-dashes in any text: commits, PR bodies, code comments, docs. Docs describe present behaviour, not
history. In inline Angular templates, element names are lowercase, and backticks break the build, even in a
comment.
