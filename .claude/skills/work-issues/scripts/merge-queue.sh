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
    sha=$(jq -r .head.sha <<<$pr)
    # Only an approval of the current head counts: commits pushed after it are unreviewed.
    review=$(gh api "$R/pulls/$n/reviews?per_page=100" \
      --jq "[.[]|select(.user.login==\"coderabbitai[bot]\" and .state!=\"COMMENTED\" and .commit_id==\"$sha\")]|last|.state" 2>/dev/null)
    if [[ $review != APPROVED ]]; then
      # After a rebase CodeRabbit often re-reviews with comments only, leaving its approval on an older
      # commit. Ask it once per head commit to review the current one.
      earlier=$(gh api "$R/pulls/$n/reviews?per_page=100" \
        --jq '[.[]|select(.user.login=="coderabbitai[bot]" and .state!="COMMENTED")]|last|.state' 2>/dev/null)
      if [[ $earlier == APPROVED ]]; then
        # Ask at most once per head commit, judged from the PR's own comments so a restart doesn't repeat it.
        pushed=$(gh api $R/commits/$sha --jq .commit.committer.date 2>/dev/null)
        asked=$(gh api "$R/issues/$n/comments?per_page=100" \
          --jq '[.[]|select(.body=="@coderabbitai review")|.created_at]|last // ""' 2>/dev/null)
        if [[ -z $asked || $asked < $pushed ]]; then
          gh api $R/issues/$n/comments -f body='@coderabbitai review' >/dev/null 2>&1 && echo "#$n asked CodeRabbit to review the current head"
        fi
      fi
      continue
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
