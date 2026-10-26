#!/bin/zsh
# Pauses (SIGSTOP) the issue agents' processes, and every child of them, when the Mac is under memory
# pressure or sustained load, and resumes them (SIGCONT) once it recovers. Logs to /tmp/memwatch.log.
#
#   PATTERN='\.claude/worktrees/agent-(id1|id2)' .claude/skills/work-issues/scripts/watchdog.sh &
#
# Run it from this file, never inline: agents' `pkill -f` cleanup matches command lines. Restarting it is
# safe, because it resumes anything a previous run left stopped, including what has left the agents' process
# trees since (a daemon reparented to launchd, the child of a killed parent), from /tmp/memwatch.stopped.
PATTERN=${PATTERN:-'\.claude/worktrees/agent-'}
# With other sessions, T3 Code and a simulator open, this Mac idles near 7 GB of compressed memory,
# so the pause line sits well above that. Swap growth is the other memory signal.
PAUSE_COMP_GB=10; RESUME_COMP_GB=9
# The 5-minute load average, on 14 cores. A simulator boot spikes the 1-minute one past 100 for a moment.
PAUSE_LOAD=35; RESUME_LOAD=20
SWAP_GROWTH_MB=600
paused=0
typeset -a swaphist
STOPPED=/tmp/memwatch.stopped
log() { print -r -- "$(date +%H:%M:%S) $*" >> /tmp/memwatch.log; }

# Matched processes plus all their descendants: tools an agent starts with relative paths don't match.
# Watchman is left out: its daemon is shared, starts as a child of whichever client needs it first, and a
# stopped one hangs every Metro build on the Mac with no timeout.
pids() {
  local table=$(ps -Ao pid=,ppid=,command=)
  local -a found=(${(f)"$(print -r -- $table | grep -E "$PATTERN" | grep -vE 'watchdog|watchman' | awk '{print $1}')"})
  local -a frontier=($found) next
  while (( ${#frontier} )); do
    next=(${(f)"$(print -r -- $table | awk -v list=" ${frontier[*]} " 'index(list, " "$2" ") && !/watchman/ {print $1}')"})
    next=(${next:|found}); found+=($next); frontier=($next)
  done
  print -l $found
}

# Every pid stopped is recorded, and resuming continues those as well as the current trees: a process that
# left the trees while stopped would otherwise stay stopped for good.
stop() { local -a p=($(pids)); (( ${#p} )) && { kill -STOP $p 2>/dev/null; print -l $p >> $STOPPED; } }
resume() { { pids; cat $STOPPED 2>/dev/null } | sort -u | xargs -r kill -CONT 2>/dev/null; : > $STOPPED; }

resume
while true; do
  comp=$(vm_stat | awk '/page size of/ {page=$(NF-1)} /occupied by compressor/ {gsub("\\.","",$5); printf "%.2f", $5*page/1073741824}')
  swap=$(sysctl -n vm.swapusage | awk '{gsub("M","",$6); print int($6)}')
  load=$(sysctl -n vm.loadavg | awk '{print $3}')
  swaphist+=($swap); (( ${#swaphist} > 4 )) && shift swaphist   # 4 samples of 15s: one minute
  growth=$(( swap - swaphist[1] ))
  if (( ! paused )) && (( comp > PAUSE_COMP_GB || load > PAUSE_LOAD || growth > SWAP_GROWTH_MB )); then
    stop; paused=1
    log "PAUSED comp=${comp}GB swap=${swap}MB growth=${growth}MB load=${load}"
  elif (( paused )) && (( comp < RESUME_COMP_GB && load < RESUME_LOAD && growth < 100 )); then
    resume; paused=0
    log "RESUMED comp=${comp}GB swap=${swap}MB load=${load}"
  elif (( paused )); then
    stop   # anything started since the pause
  fi
  sleep 15
done
