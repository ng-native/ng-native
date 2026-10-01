#!/bin/zsh
# Squash-merges each PR once CodeRabbit has approved it (see the approval rule below), every check has
# passed, it merges cleanly into main, and no release is running. Prints one line per event, so it suits
# a Monitor.
#
#   .claude/skills/work-issues/scripts/merge-queue.sh 118 119 120
#
# REST except for one thread count, so it keeps working while the GraphQL rate limit is spent. A PR that fails CI or conflicts
# drops out of the queue; one still waiting for review or CI stays in it.
R=repos/ng-native/ng-native
queue=($@)
# The PR's own added and removed lines against the main it branched from, per file. Hunk positions are
# left out because a rebase shifts them without changing the PR.
own_changes() {
  gh api "$R/compare/main...$1" \
    --jq '[.files[]|{f:.filename,c:((.patch//"")|split("\n")|map(select(test("^[-+]")))|join("\n"))}]|sort_by(.f)' 2>/dev/null
}
# Unresolved review threads on a PR; "?" when GraphQL is unavailable, so the PR waits.
open_threads() {
  gh api graphql -f query="{repository(owner:\"ng-native\",name:\"ng-native\"){pullRequest(number:$1){reviewThreads(first:100){nodes{isResolved}}}}}" \
    --jq '[.data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved|not)]|length' 2>/dev/null || echo "?"
}
# Says something about a PR once per run rather than on every pass.
typeset -A noted
note() { [[ -n ${noted[$1:$2]} ]] || { echo "#$1 $2"; noted[$1:$2]=1; }; }
while (( ${#queue} )); do
  for n in $queue; do
    pr=$(gh api $R/pulls/$n 2>/dev/null) || continue
    state=$(jq -r 'if .merged_at then "merged" else .state end' <<<$pr)
    if [[ $state != open ]]; then echo "#$n is $state, done"; queue=(${queue:#$n}); continue; fi
    # A stacked PR waits until its base has merged and GitHub has moved it to main.
    [[ $(jq -r .base.ref <<<$pr) == main ]] || continue
    sha=$(jq -r .head.sha <<<$pr)
    # CodeRabbit's latest verdict must be an approval. It reviews every pushed commit but won't approve one
    # it has already reviewed, so after a rebase its approval stays on an older commit. That approval
    # still counts when the PR's own changes are identical between the two commits (only the base moved)
    # and every review thread is resolved; any change to the PR's own code needs a fresh approval.
    approved=$(gh api "$R/pulls/$n/reviews?per_page=100" \
      --jq '[.[]|select(.user.login=="coderabbitai[bot]" and .state!="COMMENTED")]|last|select(.state=="APPROVED")|.commit_id' 2>/dev/null)
    [[ -n $approved ]] || continue
    if [[ $approved != $sha ]]; then
      [[ $(own_changes $approved) == $(own_changes $sha) ]] || { note $n "changed since CodeRabbit approved it"; continue; }
      [[ $(open_threads $n) == 0 ]] || continue
    fi
    runs=$(gh api "$R/commits/$sha/check-runs?per_page=100" \
      --jq '[.check_runs[]|(.conclusion // "pending")]|unique|join(",")' 2>/dev/null)
    if [[ $runs == *failure* || $runs == *cancelled* || $runs == *timed_out* ]]; then
      echo "#$n CI failed ($runs), skipping"; queue=(${queue:#$n}); continue
    fi
    [[ -n $runs && $runs != *pending* ]] || continue
    ms=$(jq -r .mergeable_state <<<$pr)
    if [[ $ms == dirty ]]; then echo "#$n conflicts with main, skipping"; queue=(${queue:#$n}); continue; fi
    [[ $ms == clean || $ms == unstable || $ms == has_hooks ]] || continue
    # A merge while a release runs moves main under it and breaks its push.
    [[ -z $(gh api "$R/actions/workflows/release.yml/runs?per_page=3" \
      --jq '.workflow_runs[]|select(.status!="completed")|.id' 2>/dev/null) ]] || continue
    # Merge exactly the head that was checked; if a commit landed since, GitHub refuses and the PR stays
    # queued for the next pass. Any failure shows GitHub's reason.
    if err=$(gh api -X PUT $R/pulls/$n/merge -f merge_method=squash -f sha="$sha" 2>&1 >/dev/null); then
      echo "#$n merged"; queue=(${queue:#$n})
    else
      echo "#$n merge failed, retrying: ${err//$'\n'/ }"
    fi
  done
  (( ${#queue} )) && sleep 180
done
echo "merge queue done"
