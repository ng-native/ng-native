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
# left out because a rebase shifts them without changing the PR. Prints nothing, so the PR waits, when the
# lookup fails, a file has no patch (a binary change) or GitHub's 300-file limit is reached.
own_changes() {
  gh api "$R/compare/main...$1" \
    --jq 'if (.files|length) >= 300 or any(.files[]; .patch == null) then empty else
      [.files[]|{f:.filename,c:(.patch|split("\n")|map(select(test("^[-+]")))|join("\n"))}]|sort_by(.f) end' 2>/dev/null
}
# Unresolved review threads on a PR; "?" when GraphQL fails or there are more than 100 threads, so the
# PR waits. (ponytail: no pagination; a PR here has never had 100 threads.)
open_threads() {
  local n
  n=$(gh api graphql -f query="{repository(owner:\"ng-native\",name:\"ng-native\"){pullRequest(number:$1){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved}}}}}" \
    --jq '.data.repository.pullRequest.reviewThreads|if .pageInfo.hasNextPage then "?" else [.nodes[]|select(.isResolved|not)]|length end' 2>/dev/null)
  # A rate-limited call prints its error JSON on stdout, so only a bare count is an answer. REST can't see
  # whether a thread is resolved, so while GraphQL is limited the PR waits ("?") rather than guess.
  [[ $n == <-> ]] && echo $n || echo "?"
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
    # CodeRabbit has to have passed the PR's current code. It reviews every pushed commit but won't post a
    # fresh approval on one it has already reviewed, so any one of these counts, with every review thread
    # resolved in the last two:
    #  - its approval is on the current commit;
    #  - it has reviewed the current commit (with or without a verdict) and left nothing open;
    #  - its approval is on an older commit and the PR's own changes are identical (only the base moved).
    reviews=$(gh api --paginate "$R/pulls/$n/reviews?per_page=100" 2>/dev/null | jq -s 'add') || continue
    approved=$(jq -r '[.[]|select(.user.login=="coderabbitai[bot]" and .state!="COMMENTED")]|last|select(.state=="APPROVED")|.commit_id' <<<$reviews)
    reviewed_head=$(jq -r --arg sha $sha '[.[]|select(.user.login=="coderabbitai[bot]" and .commit_id==$sha)]|length' <<<$reviews)
    # A push with nothing new for it to review gets no review object, but CodeRabbit's summary comment
    # still records the range it covered, ending at the current commit.
    if (( reviewed_head == 0 )); then
      reviewed_head=$(gh api --paginate "$R/issues/$n/comments?per_page=100" \
        --jq ".[]|select(.user.login==\"coderabbitai[bot]\" and (.body|contains(\"and $sha\")))|.id" 2>/dev/null | wc -l | tr -d ' ')
    fi
    # A "changes requested" verdict on the current commit holds the PR, even with its threads resolved:
    # a rebutted comment waits for a later push to get a review that doesn't request changes.
    if [[ $(jq -r '[.[]|select(.user.login=="coderabbitai[bot]" and .state!="COMMENTED")]|last|"\(.state) \(.commit_id)"' <<<$reviews) == "CHANGES_REQUESTED $sha" ]]; then
      note $n "has changes requested on its current commit"; continue
    fi
    if [[ $approved != $sha ]]; then
      if (( reviewed_head > 0 )); then
        [[ $(open_threads $n) == 0 ]] || continue
      elif [[ -n $approved ]] && then_=$(own_changes $approved) && now=$(own_changes $sha) &&
        [[ -n $then_ && $then_ == $now ]]; then
        [[ $(open_threads $n) == 0 ]] || continue
      else
        note $n "waits for CodeRabbit to review its current commit"; continue
      fi
    fi
    # A run cancelled because a duplicate superseded it (a retarget starts a second set) doesn't count
    # when the same check has another run.
    runs=$(gh api "$R/commits/$sha/check-runs?per_page=100" \
      --jq '[.check_runs|group_by(.name)[]|map(.conclusion // "pending")|(map(select(. != "cancelled"))|if length > 0 then . else ["cancelled"] end)[]]|unique|join(",")' 2>/dev/null)
    if [[ $runs == *failure* || $runs == *cancelled* || $runs == *timed_out* ]]; then
      echo "#$n CI failed ($runs), skipping"; queue=(${queue:#$n}); continue
    fi
    [[ -n $runs && $runs != *pending* ]] || continue
    ms=$(jq -r .mergeable_state <<<$pr)
    if [[ $ms == dirty ]]; then echo "#$n conflicts with main, skipping"; queue=(${queue:#$n}); continue; fi
    [[ $ms == clean || $ms == unstable || $ms == has_hooks ]] || continue
    # Two lockfile changes can merge cleanly as text into a lockfile pnpm rejects (#279 after #277), so a
    # PR that changes pnpm-lock.yaml waits until it's updated with any lockfile change main has since had.
    # A failed request, or a list GitHub may have cut short (3,000 files for a PR, 300 for a compare),
    # keeps the PR waiting.
    (( $(jq .changed_files <<<$pr) < 3000 )) || { note $n "changes too many files to check its lockfile"; continue; }
    files=$(gh api --paginate "$R/pulls/$n/files?per_page=100" --jq '.[].filename' 2>/dev/null) || continue
    if grep -qx pnpm-lock.yaml <<<$files; then
      base=$(gh api "$R/compare/main...$sha" --jq .merge_base_commit.sha 2>/dev/null) || continue
      moved=$(gh api "$R/compare/$base...main" --jq 'if (.files|length) >= 300 then "pnpm-lock.yaml" else .files[].filename end' 2>/dev/null) || continue
      if grep -qx pnpm-lock.yaml <<<$moved; then
        note $n "changes the lockfile and main's lockfile changed since its base; update it from main"; continue
      fi
    fi
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
