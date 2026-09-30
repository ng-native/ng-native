#!/bin/zsh
# Pauses (SIGSTOP) the issue agents' processes, and every child of them, when the Mac is under memory
# pressure or sustained load, and resumes them (SIGCONT) once it recovers. Logs to /tmp/memwatch.log.
#
#   PATTERN='\.claude/worktrees/agent-(id1|id2)' .claude/skills/work-issues/scripts/watchdog.sh &
#
# Run it from this file, never inline: agents' `pkill -f` cleanup matches command lines. Restarting it is
# safe, because it resumes anything a previous run left stopped.
PATTERN=${PATTERN:-'\.claude/worktrees/agent-'}
# With other sessions, T3 Code and a simulator open, this Mac idles near 7 GB of compressed memory,
# so the pause line sits well above that. Swap growth is the other memory signal.
PAUSE_COMP_GB=10; RESUME_COMP_GB=9
# The 5-minute load average, on 14 cores. A simulator boot spikes the 1-minute one past 100 for a moment.
PAUSE_LOAD=35; RESUME_LOAD=20
SWAP_GROWTH_MB=600
paused=0
typeset -a swaphist
log() { print -r -- "$(date +%H:%M:%S) $*" >> /tmp/memwatch.log; }

# Matched processes plus all their descendants: tools an agent starts with relative paths don't match.
pids() {
  local table=$(ps -Ao pid=,ppid=,command=)
  local -a found=(${(f)"$(print -r -- $table | grep -E "$PATTERN" | grep -v watchdog | awk '{print $1}')"})
  local -a frontier=($found) next
  while (( ${#frontier} )); do
    next=(${(f)"$(print -r -- $table | awk -v list=" ${frontier[*]} " 'index(list, " "$2" ") {print $1}')"})
    next=(${next:|found}); found+=($next); frontier=($next)
  done
  print -l $found
}

pids | xargs -r kill -CONT 2>/dev/null
while true; do
  comp=$(vm_stat | awk '/occupied by compressor/ {gsub("\\.","",$5); printf "%.2f", $5*16384/1073741824}')
  swap=$(sysctl -n vm.swapusage | awk '{gsub("M","",$6); print int($6)}')
  load=$(sysctl -n vm.loadavg | awk '{print $3}')
  swaphist+=($swap); (( ${#swaphist} > 4 )) && shift swaphist   # 4 samples of 15s: one minute
  growth=$(( swap - swaphist[1] ))
  if (( ! paused )) && (( comp > PAUSE_COMP_GB || load > PAUSE_LOAD || growth > SWAP_GROWTH_MB )); then
    pids | xargs -r kill -STOP 2>/dev/null; paused=1
    log "PAUSED comp=${comp}GB swap=${swap}MB growth=${growth}MB load=${load}"
  elif (( paused )) && (( comp < RESUME_COMP_GB && load < RESUME_LOAD && growth < 100 )); then
    pids | xargs -r kill -CONT 2>/dev/null; paused=0
    log "RESUMED comp=${comp}GB swap=${swap}MB load=${load}"
  elif (( paused )); then
    pids | xargs -r kill -STOP 2>/dev/null   # anything started since the pause
  fi
  sleep 15
done
