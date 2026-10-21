---
name: fix-issue
description: Take one GitHub issue from report to merged-ready PR - verify the report without trusting it, reproduce it in a test and, when it shows on a device, on a simulator or emulator, write a failing test, make the minimal fix, prove the test bites by reverting and mutating the fix, run the checks, verify the fix on that device, review the diff adversarially, and open the PR. Also covers answering review comments and CI failures on that PR. Use when asked to fix, work on, or pick up an issue, or to address review comments or a failing check on an issue's PR.
---

# Fix an issue

One issue, end to end. Read [AGENTS.md](../../../AGENTS.md), [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md),
[CONTEXT.md](../../../docs/CONTEXT.md), [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
[.claude/rules/angular.md](../../rules/angular.md) first.

Keep a running record as you go: each claim and its evidence, the repro commands, the test's failures, the
mutation results and the device artifacts. The PR body in step 11 is built from it.

## 0. Check nobody has it, and branch

`git fetch origin`, then look for work already under way:
`gh pr list -R ng-native/ng-native --state all --search "<n>"` and `git branch -r --list '*<slug>*'`. An open PR
or a recent closed one for the same issue goes back to whoever owns the batch before you start.

Then branch from the latest main: `git switch -c fix/<slug> origin/main`. A PR that needs another merged
first is stacked: it branches from that PR's branch (`origin/<that branch>`) instead, so it carries those
commits. A fresh worktree has no `node_modules`, so run `pnpm install` once
you are on the branch.

## 1. Verify the report

Read it with `gh issue view <n> -R ng-native/ng-native --comments`, then check every claim against the code on
the latest `origin/main`. Reports are often partly wrong: the symptom is real but the cause, the scope, the repro
or the suggested fix is not. Record what is right, what is wrong, and the evidence for each.

Check against the reference the package follows, not against the report:

- **CSS (compiler and engine):** what Chrome does. The repo has a Chrome oracle
  (`packages/integration-tests/fixtures/css-oracle-cases.ts` and its generator).
- **Components and accessibility:** React Native's own source in `node_modules` for the version in use,
  per component, since `Pressable`, `TouchableOpacity`, `Text` and `Switch` differ.
- **Nx, Metro and installs:** the real tools, at the versions the reporter used where it matters.

Then decide whether the bug **shows on a device**: anything someone sees or touches in a running app
(rendering, layout, styles, text, images, gestures, the keyboard, navigation, screen readers, native modules)
does. Generators, installs, the Nx plugin, types and the build do not. Decide the platforms too:

- The report names one platform, or the code path is one platform's (`Platform.OS`, a file under
  `packages/expo/ios` or `android`): that platform.
- Shared code with a visible symptom: both. A bug that "only happens on iOS" is often on Android too.

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
- **Bugs that show on a device:** also on a simulator, an emulator or both, as step 1 decided, following
  [devices.md](devices.md). Build the smallest screen that shows it (a canary page, or the reporter's snippet
  dropped into one, which stays out of the PR unless it earns a place in the canary) and drive it with
  commands, not by hand, so step 8 can run the same steps again. Keep the
  commands, and capture what shows the bug: a screenshot, the accessibility tree, a measured value, a log
  line. A screenshot alone is weak evidence for anything that moves; see devices.md.

When the test fails but the device looks right, or the other way round, one of them is not reproducing the
report. Find out which before going on. When a device repro is not possible (hardware-only, such as haptics
or a physical phone's sensor, or a tool that is missing and cannot be installed), say so and why.

## 3. Write the failing test

The test fails on current code, for the reason the issue describes. A test that fails for another reason proves
nothing.

- The CSS compiler and engine fail silently, so they are strictly test-first.
- A custom-property value has two paths, a stylesheet and a value set on an element. Test both, with a parity
  row for each shape, and use Chrome's value as the expected one.
- A test that reads an implementation detail (such as a stored declaration) breaks when that detail changes.
  Compare what renders instead: an element styled the same way by a plain class, or the committed props.
- Assert what the device showed wrong, as closely as a Node test can: the committed props or layout the
  native view gets, not an intermediate value.

## 4. Make the minimal fix

Fix the cause in the right layer, in the surrounding style, with no speculative abstraction. Prefer an existing
seam (an option the code already takes, a shared helper, the machinery an earlier fix added) to a new one.

When the fix is a real design choice (two layers it could live in, a public API or output change, a behaviour
that contradicts the docs), stop and put the options to whoever owns the batch, with a recommendation. Keep
prototyping the recommended one while you wait.

A test that pinned the old behaviour may need to change. Only change it with evidence that the new behaviour
is right, and say so in the PR.

## 5. Prove the test bites

**Revert.** With the fix in place, the new test passes. Revert just the fix and confirm the test fails again
for the same reason. Then restore it. Report both results.

**Mutate.** Reverting the whole fix only proves the test notices the fix is missing, not that it pins what the
fix does. So break the fix one line at a time. For each line of the fix that decides something (a condition,
a comparison, a value written, a guard, an early return), apply one mutation:

- delete a side effect (a `.set(`, `.delete(`, `.push(`, an assignment, a cache write or invalidation)
- negate a condition, or swap `&&` and `||`, `===` and `!==`
- move a boundary: `<` and `<=`, `>` and `>=`, `+ 1` and `- 1`
- delete a guard or early return
- hard-code a computed value, or flip `true` and `false`

Three to eight mutations is enough for most fixes. After each one, run the new test's file on its own (in
`packages/integration-tests`, `node --import ./register-linker.mjs --test <file>`, a few seconds), then
restore the line and check the file matches its state before the mutation. Commit the fix as a WIP commit
first so `git diff --quiet -- <file>` can tell, and `git checkout -- <file>` can restore it. Never stack two
mutations, and never leave one in the tree.

A mutation the tests kill is fine. One that survives is either equivalent (the code behaves the same, such as
a guard a later check covers too, which is worth a sentence on whether the line is needed) or a gap: add the
assertion that kills it, then re-apply the mutation to confirm. Report the score, such as "6 of 7 killed; the
survivor is equivalent because ...".

A fix spread over many files can use the coverage-guided runner in
`~/.claude/skills/mutation-testing/ng-native/` when it is on the machine (usage is at the top of each script).
It runs only the tests that cover each mutated line, but its paths point at one old worktree, so change them
first, and run it in a worktree nothing else is editing.

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

Then run the [review-change](../review-change/SKILL.md) checklist over the diff. Fix the real findings, each
with a test. Anything outside the issue goes in the PR as a follow-up rather than into the diff.

## 8. Verify on the device

Tests prove the code, not the app. For a bug step 2 reproduced on a device, run step 2's commands again on the same
device(s), with the fix and the review's changes in place, and capture the same artifact. It is fixed when the
artifact shows the report's expected behaviour, not merely something different.

- Restart Metro with `--clear` after any change under `packages/metro` or to a transform; a running Metro keeps
  the old compiler. See devices.md.
- Check what the fix could reach beyond the repro: the same component elsewhere in the canary, dark mode, the
  smallest and largest text sizes for anything with text, the other platform for shared code, and a rotation
  for layout.
- Expo Go is a release build without React Native's debug assertions and cannot load native changes. A fix to
  layout or to `packages/expo/ios` or `android` needs a debug build; see devices.md.

If the device still shows the bug while the test passes, the test is pinning the wrong thing: go back to step 3.

## 9. Version plan

Add one when someone using the packages would notice the change: `npx nx release plan`, or by hand in
`.nx/version-plans/` (the format is in [docs/RELEASING.md](../../../docs/RELEASING.md)). The body's first
line becomes the changelog bullet, so make it one whole, unwrapped summary sentence, with detail below. Plans
have no heading. Say plainly when output, announcements, query results or types change. The bump is
`patch` unless the change breaks something; `minor` is the breaking bump under `0.x`. Check every sentence
against the code as you would docs: reviewers most often flag a plan that overstates ("every") or leaves
out a platform or OS qualifier.

## 10. Clean up

Shut down and delete the devices you created, stop your Metro, release the build lock if you hold it, delete
scratch workspaces, remove a repro page that is not staying, and delete the `examples/*/ios` and `android`
folders a native build generated (lint and typecheck scan them). `git status` and `git diff <base>` (`origin/main`, or the
branch a stacked PR depends on) show only the fix, its tests and the version plan.

## 11. Open the PR

- Turn step 5's WIP commit and what followed into the PR's commits (`git commit --amend`, or
  `git reset --soft <base>` and commit again), each with a sentence-case summary: no `feat:`/`fix:`
  prefix, no co-author trailer.
- When main has moved since step 0, rebase onto it and run the affected tests again.
- Before pushing, check that no release is running. A merge while a release runs breaks its push.
  `gh api 'repos/ng-native/ng-native/actions/workflows/release.yml/runs?per_page=1' --jq '.workflow_runs[0].status'`
  must print `completed`.
- Push, then open the PR. `gh pr create` uses GraphQL. When that limit is spent, use REST:
  `gh api repos/ng-native/ng-native/pulls -f title=... -f head=... -f base=<main, or the branch a stacked PR depends on> -f body=...`.
- The body has these sections, and says `Closes #<n>`. No AI attribution anywhere.
  - **Cause:** what was wrong in the report and what was right, with the evidence.
  - **Fix:** what changed and why in that layer.
  - **Verification:** the test and its failure before the fix; the revert result; the mutation score and any
    survivor explained; the checks run; on the device, the platforms, OS versions and app (Expo Go or a debug
    build), the steps, and the before and after artifacts. `gh` cannot attach images, so give their paths or
    the measured values.
  - **Follow-ups:** anything found and left out of the diff.
- Never merge your own PR.

Two issues that share one fix can share a PR. A stacked PR is opened with `--base` on the branch it depends
on, and says so in its body.

## Review comments and CI failures

**Review comments.** Validate each one; a reviewer can be wrong. When it is right, fix it test-first, push,
reply with what changed, and resolve the thread. When it is wrong, reply with the evidence and resolve it.
Resolving a thread needs GraphQL (`resolveReviewThread`); REST can reply but not resolve. A change to the fix
repeats step 5's mutations on the changed lines and step 8 on the device.

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

## Writing

No em-dashes in any text: commits, PR bodies, code comments, docs. Docs describe present behaviour, not
history. In inline Angular templates, element names are lowercase, and backticks break the build, even in a
comment.
