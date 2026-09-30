---
name: work-issues
description: Work through a batch of open GitHub issues with parallel agents, each following the fix-issue skill, without overloading the Mac or breaking a release - triage and group the issues, run the agents, relay progress and decisions, handle review comments and CI, merge approved PRs through a release-safe queue, and clean up. Use when asked to work through the open issues, fix a list of issues, or keep a batch of PRs moving to merge.
---

# Work through issues

The coordinating session runs the batch. Each agent takes one group of issues through the
[fix-issue](../fix-issue/SKILL.md) skill in its own worktree. The coordinator stays out of the code: it
triages, relays, merges and cleans up.

## 1. Triage

List what is open through REST (`gh api "repos/ng-native/ng-native/issues?state=open&per_page=100"` and
`.../pulls?state=open`). GraphQL shares one limit of 5,000 requests an hour across every agent and tool,
and a busy batch spends it.

Group the issues by the code they touch, so no two agents edit the same files:

- the Nx generator
- Metro and Tailwind
- the CSS compiler and engine
- components and testing

Issues that share a fix go to one agent, which may use one PR. Two issues in the same file go to one agent
in turn, with the second PR stacked when they would conflict.

Before starting, check for an open PR from elsewhere (another session or a contributor) that touches the
same code, and tell the agent about it.

## 2. Run the agents

- **At most four at once,** each with worktree isolation. More than that exhausted the Mac's memory once and
  took the session down.
- **Brief every agent** with the fix-issue skill, its issues, anything learned since it was written (a
  related PR, a known flake, a decision already made), and these instructions: send a one-line update at
  each milestone, ask when a decision is needed, and never merge.
- **Start the watchdog** for the running agents, from its file:

  ```sh
  PATTERN='\.claude/worktrees/agent-(<id>|<id>)' .claude/skills/work-issues/scripts/watchdog.sh &
  ```

  It pauses the agents and their child processes under memory pressure or sustained load, and resumes them
  after. Update `PATTERN` and restart it as agents come and go; a restart resumes anything left stopped.
  Stop it when no agent is running.

- **Device checks:** an agent that needs a simulator takes the shared device lock. The simulator it starts is
  not its child, so pausing the agent can deadlock the check. If that happens, exempt the agent for the
  length of the check.
- **Tell a paused agent afterwards,** so it re-runs a command that timed out rather than treating the timeout
  as a failure.

## 3. Relay and decide

Pass each agent's milestones to the user in plain terms: is the report correct, was it reproduced and how,
does the test bite, what did the review find, and the PR link. Link every PR to the thread if the harness
has a tool for it.

These go to the user as a question, with a recommendation first:

- a design choice an agent raises;
- a change to public behaviour, output or types that the docs don't already settle;
- merging a PR without the reviewer's approval;
- anything outward-facing that wasn't asked for, such as closing or commenting on an issue, or filing a new
  one.

Check an agent's claim before passing it on. When it contradicts what you already know (an issue it says is
fixed, a release it says went out), look it up.

Follow-ups an agent finds but leaves out of its PR get collected. Offer to file them; don't file them
unasked.

## 4. Merge

Run the merge queue for PRs once they are open:

```sh
.claude/skills/work-issues/scripts/merge-queue.sh <pr> <pr> ...
```

- **What it waits for:** CodeRabbit's approval, every check green, a clean merge into main, and no release
  running. Then it squash-merges.
- **When a PR drops out:** a PR that fails CI or conflicts leaves the queue. Find out why before putting it
  back.
- **Stale "changes requested":** after its threads are resolved, CodeRabbit can leave "changes requested"
  standing. When a PR is green with every thread resolved and still not approved, ask the user.
- **Review comments on a PR:** send them back to the agent that wrote it; it has the context.
- **CI failures:** send those back to the same agent. Re-run a failed job only once the failure is shown not
  to be the PR's.
- **A squashed base:** squashing a stacked PR's base leaves the stacked PR conflicting. Rebase its own commits
  onto main as fix-issue describes, and put it back in the queue.

## 5. Releases

The Release workflow is run from the Actions tab once CI on main is green (`docs/RELEASING.md`).

- A merge while it runs breaks its push, so the queue holds while a release runs.
- `nx.json` sets `adjustSemverBumpsForZeroMajorVersion: false`, so the bump the workflow is given is the one
  released: `minor` for a breaking change under 0.x, `patch` otherwise.
- If a release fails, read its log before re-running: the packages may already be on npm while main, the tag
  and the GitHub release are not.

## 6. Clean up

When a group's PRs have merged:

- Remove its agent worktrees. Check each is clean first; its work is on main.
- Delete any temporary branches you made.
- Stop the watchdog and the merge queue, and remove the device lock if one is left.
- Leave other threads' worktrees alone.

Report what merged and which issues it closed, what is still open, and the follow-ups found.
