#!/bin/zsh
# Squash-merges each PR once Greptile has reviewed it with nothing left open (see the rule below), every check has
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
# The packages (or top-level directories) the file paths on stdin fall in, sorted for comm. Version plans
# are new files that never clash, so .nx is left out.
pkgs() { awk -F/ '$1 != ".nx" {print ($1=="packages"||$1=="examples") ? $1"/"$2 : $1}' | sort -u; }
note() { [[ -n ${noted[$1:$2]} ]] || { echo "#$1 $2"; noted[$1:$2]=1; }; }
while (( ${#queue} )); do
  for n in $queue; do
    pr=$(gh api $R/pulls/$n 2>/dev/null) || continue
    state=$(jq -r 'if .merged_at then "merged" else .state end' <<<$pr)
    # An unreadable answer (a full disk, a cut-off reply) keeps the PR queued rather than reading as closed.
    [[ $state == (open|closed|merged) ]] || continue
    if [[ $state != open ]]; then echo "#$n is $state, done"; queue=(${queue:#$n}); continue; fi
    # A stacked PR waits until its base has merged and GitHub has moved it to main.
    [[ $(jq -r .base.ref <<<$pr) == main ]] || continue
    sha=$(jq -r .head.sha <<<$pr)
    # Greptile has to have reviewed the PR's current code. It never approves: it leaves a COMMENTED review
    # with inline P1/P2 comments, or only a check run when it has none. So the PR passes when every review
    # thread is resolved and either:
    #  - Greptile has reviewed the current commit;
    #  - it reviewed an older commit and the PR's own changes are identical (only the base moved).
    reviewed=$(gh api --paginate "$R/pulls/$n/reviews?per_page=100" \
      --jq '.[]|select(.user.login=="greptile-apps[bot]")|.commit_id' 2>/dev/null) || continue
    lines=(${(f)reviewed}); reviewed=${lines[-1]}
    # A review that adds no comments posts no review object, only a successful "Greptile Review" check run,
    # so the newest commit with one counts too when it is newer than the last review object.
    commits=$(gh api --paginate "$R/pulls/$n/commits?per_page=100" --jq '.[].sha' 2>/dev/null) || continue
    for c in ${(Oa)${(f)commits}}; do
      [[ $c == $reviewed ]] && break
      if [[ $(gh api "$R/commits/$c/check-runs?check_name=Greptile%20Review" \
        --jq '[.check_runs[]|select(.conclusion=="success")]|length' 2>/dev/null) == <1-> ]]; then
        reviewed=$c; break
      fi
    done
    if [[ -z $reviewed ]]; then note $n "waits for Greptile's review"; continue; fi
    if [[ $reviewed != $sha ]] && ! { then_=$(own_changes $reviewed) && now=$(own_changes $sha) &&
      [[ -n $then_ && $then_ == $now ]]; }; then
      note $n "waits for Greptile to review its current commit"; continue
    fi
    if [[ $(open_threads $n) != 0 ]]; then note $n "has unresolved review threads"; continue; fi
    # GitHub runs no CI on a PR that conflicts with main, so this comes before the CI check, which would
    # otherwise wait on it forever.
    ms=$(jq -r .mergeable_state <<<$pr)
    if [[ $ms == dirty ]]; then echo "#$n conflicts with main, skipping"; queue=(${queue:#$n}); continue; fi
    # A run cancelled because a duplicate superseded it (a retarget starts a second set) doesn't count
    # when the same check has another run.
    checks=$(gh api "$R/commits/$sha/check-runs?per_page=100" 2>/dev/null) || continue
    runs=$(jq -r '[.check_runs|group_by(.name)[]|map(.conclusion // "pending")|(map(select(. != "cancelled"))|if length > 0 then . else ["cancelled"] end)[]]|unique|join(",")' <<<$checks)
    if [[ $runs == *failure* || $runs == *cancelled* || $runs == *timed_out* ]]; then
      echo "#$n CI failed ($runs), skipping"; queue=(${queue:#$n}); continue
    fi
    [[ -n $runs && $runs != *pending* ]] || continue
    [[ $ms == clean || $ms == unstable || $ms == has_hooks ]] || continue
    # Two lockfile changes can merge cleanly as text into a lockfile pnpm rejects (#279 after #277), so a
    # PR that changes pnpm-lock.yaml waits until it's updated with any lockfile change main has since had.
    # A failed request, or a list GitHub may have cut short (3,000 files for a PR, 300 for a compare),
    # keeps the PR waiting.
    (( $(jq .changed_files <<<$pr) < 3000 )) || { note $n "changes too many files to check its lockfile"; continue; }
    files=$(gh api --paginate "$R/pulls/$n/files?per_page=100" --jq '.[].filename' 2>/dev/null) || continue
    # Merge skew: green CI only covers the main it ran against. When main has since changed a package this PR
    # also changes, main is merged into the PR so CI and Greptile run again (a re-run would reuse the old
    # checkout). #1087 broke main by merging on a run from before #1083.
    # The earliest run of any check on this commit: a re-run keeps its first checkout, so a later start
    # time would hide the main it actually tested.
    starts=$(gh api --paginate "$R/commits/$sha/check-runs?filter=all&per_page=100" \
      --jq '.check_runs[]|select(.name != "Greptile Review")|.started_at' 2>/dev/null) || continue
    lines=(${(of)starts}); started=${lines[1]}
    [[ -n $started ]] || continue
    tested=$(gh api "$R/commits?sha=main&until=$started&per_page=1" --jq '.[0].sha' 2>/dev/null) || continue
    moved=$(gh api "$R/compare/$tested...main" --jq 'if (.files|length) >= 300 then "*" else .files[].filename end' 2>/dev/null) || continue
    if [[ -n $moved ]] && { [[ $moved == "*" ]] || [[ -n $(comm -12 <(pkgs <<<$files) <(pkgs <<<$moved)) ]]; }; then
      if gh api -X PUT "$R/pulls/$n/update-branch" -f expected_head_sha=$sha >/dev/null 2>&1; then
        echo "#$n: main changed its packages since CI ran; merged main in for a fresh run"
      else
        note $n "main changed its packages since CI ran and merging main in failed; update it by hand"
      fi
      continue
    fi
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
