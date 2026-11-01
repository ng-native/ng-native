---
name: review-batch
description: Work through the open pull requests one at a time - invoke the review-change skill on each, fix what it finds, push, wait for a bot review and green CI, repeat until the head is clean, merge, and go to the next. Findings the pull request did not cause become standalone issues. Use when asked to go through, review or merge the open pull requests, or a list of them.
---

# Review a batch of pull requests

One pull request at a time, each taken all the way to merged or to a stated reason it stopped. Run
this directly: no agents, and no fan-out. For a batch of issues rather than pull requests, use
[work-issues](../work-issues/SKILL.md).

## 1. List the batch

```sh
gh pr list --state open --limit 200 --json number,title,author,baseRefName,isDraft,mergeable,headRefOid
```

Fail closed: a failed `gh` call is not an empty list, and 200 results means the list may be cut
short. Leave out drafts and any pull request whose base is not main, which bots skip and the stack
merges, and say so in the report.
Work through in this order: anything already green and small first, then by number, and a pull
request that will conflict with another after the one it conflicts with. Check that no Release run
is queued or running before each merge:

```sh
gh run list --workflow=release --limit 20 --json status --jq '[.[]|select(.status!="completed")]|length'
```

A dry run and a real release run in separate concurrency groups, so the newest run alone can miss one.

## 2. For each pull request

**Invoke `review-change` through the Skill tool, on this pull request, every time.** Following its
checklist from memory or from an earlier read in the session is not running it. Do what it says in
full: every changed file read, the graded report, the checks it names for the surfaces touched,
Chrome for CSS and layout, bench on both sides. A step that cannot run is reported as not run, with
the reason. Give each long check its worktree to itself: never switch branch or edit there while
one runs.

Then:

1. **Fix what is real,** on the pull request's own branch: everything it introduced at medium or
   above, and a low finding when the fix is small. A low finding left in place goes in the report. A
   code fix has a test that fails without it. Prove that by reverting, and read why it failed: a file
   that does not load also reads as a failure.
2. **Verify each bot comment before acting on it.** Fix the ones that hold. Reply to the ones that do
   not with what was checked, and resolve the thread either way.
3. **Push once.** Batch the fixes, and join the checks to the push so a failure stops it:
   `pnpm format:check && pnpm exec nx affected -t lint typecheck --base=origin/main --head=HEAD && git push ...`.
   Read the exit code of the checks, not the code of the last command in a pipeline.
4. **Wait** for CI and a bot review of the new head. A review or a check that lands on a new head
   goes back to step 2. Repeat until a pass has nothing to fix.
5. **Merge** when every gate holds, then start the next pull request.

## 3. The gates

All of these, on the current head, checked again immediately before merging. A `gh` call that fails
or is rate limited proves nothing: stop and ask again, and do not merge on it.

- `review-change` has run on this pull request, and on the changed lines of any fix pushed since,
  with nothing it introduced left at medium or above.
- Every check green. Skipped counts as green for `deploy`, and for `CodeRabbit` only under the bot
  author exception below.
- A bot has reviewed this head: the `CodeRabbit` check is not pending, and a bot's review has
  `commit.oid` equal to the head (`gh pr view <n> --json reviews,headRefOid`). `reviewDecision` alone
  does not show this, because an approval of an older commit stays after a push.
- No unresolved review threads. This prints the id of each one, and nothing when there are none:

  ```sh
  gh api graphql --paginate -F n=<n> -f query='query($n:Int!,$endCursor:String){repository(owner:"ng-native",name:"ng-native"){pullRequest(number:$n){reviewThreads(first:100,after:$endCursor){nodes{id isResolved} pageInfo{hasNextPage endCursor}}}}}' \
    --jq '.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved|not)|.id'
  ```

- `mergeable` is `MERGEABLE`. It reads `UNKNOWN` for a short while after another merge: wait and ask
  again, and never treat that as a conflict.
- No Release run in progress.

```sh
gh pr merge <n> --squash --match-head-commit <full sha>
```

`--match-head-commit` binds the merge to what was reviewed. Merge a green pull request as it is when
main has moved; rebase only on a conflict.

## 4. Pushing to a contributor's branch

If `maintainerCanModify` is false in the first command below, leave the findings as a comment and move on.

```sh
gh pr view <n> --json maintainerCanModify,headRepositoryOwner,headRepository,headRefName
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  push https://github.com/<owner>/<repository>.git HEAD:<head ref>
```

Add commits; never force-push over someone else's work. Never approve a held workflow run for a
first-time contributor: a pull request held there stops, and the report says so.

## 5. Bots and CI

- **CodeRabbit paused** after a burst of commits: post `@coderabbitai review`. It reviews about four
  times an hour, so a limit message means wait, not skip.
- **A review of an older commit:** a stale `CHANGES_REQUESTED` stands until the head is reviewed. An
  outdated thread still needs checking against the head before it is resolved.
- **A bot author:** CodeRabbit skips Dependabot's pull requests and refuses a manual request. A full
  `review-change` pass on the head stands in, plus checking that a pinned action's SHA is the tag it
  claims. An annotated tag's commit is its peeled line:
  `git ls-remote https://github.com/<action> 'refs/tags/<tag>^{}'`. Name this exception in the
  report.
- **A red check:** read the failing step's log before anything else. Rerun with
  `gh run rerun <id> --failed` only for a known flake, such as
  `css/selectors/focus-display-none-001.html` alone in Web Platform Tests. A rerun reuses the old
  checkout, so a flake that repeats needs a rebase.
- **Watching:** one watcher for the whole batch, printing only when a pull request settles or fails.
  One line per pending-count change is noise, and many watchers hit the rate limit.

## 6. Findings the pull request did not cause

Do not grow the pull request to fix them, and do not drop them. Confirm the finding is on main by
running the same case there, then file one issue per root cause. An issue stands alone: the input,
the wrong result, Chrome's or the platform's result, and what confirms it if it is only plausible.
It names no pull request. Search the open issues first, and check every sentence against what was
actually run.

## 7. Report

Keep the batch's report to what is needed to walk away:

- What merged, each with its risk, what was fixed and its checks.
- What stopped, and the one thing it needs.
- Every exception to the gates, by name.
- What was not run.
- The issues filed.

Then check main's CI on the last merge, wait for it, and say how it went. Remove any local branches
and worktrees the batch made.
