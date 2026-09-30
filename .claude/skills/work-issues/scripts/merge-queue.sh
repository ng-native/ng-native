#!/bin/zsh
# Squash-merges each PR once CodeRabbit's latest review approves it, every check has passed, it merges
# cleanly into main, and no release is running. Prints one line per event, so it suits a Monitor.
#
#   .claude/skills/work-issues/scripts/merge-queue.sh 118 119 120
#
# REST only, so it keeps working when the GraphQL rate limit is spent. A PR that fails CI or conflicts
# drops out of the queue; one still waiting for review or CI stays in it.
R=repos/ng-native/ng-native
queue=($@)
while (( ${#queue} )); do
  for n in $queue; do
    pr=$(gh api $R/pulls/$n 2>/dev/null) || continue
    state=$(jq -r 'if .merged_at then "merged" else .state end' <<<$pr)
    if [[ $state != open ]]; then echo "#$n is $state, done"; queue=(${queue:#$n}); continue; fi
    # A stacked PR waits until its base has merged and GitHub has moved it to main.
    [[ $(jq -r .base.ref <<<$pr) == main ]] || continue
    review=$(gh api "$R/pulls/$n/reviews?per_page=100" \
      --jq '[.[]|select(.user.login=="coderabbitai[bot]" and .state!="COMMENTED")]|last|.state' 2>/dev/null)
    [[ $review == APPROVED ]] || continue
    sha=$(jq -r .head.sha <<<$pr)
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
    if gh api -X PUT $R/pulls/$n/merge -f merge_method=squash >/dev/null 2>&1; then echo "#$n merged"
    else echo "#$n merge failed"; fi
    queue=(${queue:#$n})
  done
  (( ${#queue} )) && sleep 180
done
echo "merge queue done"
