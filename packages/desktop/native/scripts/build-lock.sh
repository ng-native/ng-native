# shellcheck shell=bash
# Sourced by build.sh: one build at a time in a build directory.
#
#   lock_build <build dir>
#
# Two ninja processes in one build directory both append to its .ninja_deps, and the next build
# finds the log corrupt ("premature end of file; recovering"), drops every record after the
# clash and compiles those objects again: a run beside another, or beside one a killed command
# left running, recompiles hundreds of objects on the run after it. The lock is the kernel's flock
# on <build dir>/.ngn-build-lock, held through the calling shell's descriptor 7 (Perl takes it,
# since macOS has no flock command) until that shell exits, and by the cmake and ninja it starts,
# which inherit the descriptor, so a build whose script was killed still holds it until ninja
# stops. A second build waits for it, then finds nothing left to do.
lock_build() {
  mkdir -p "$1"
  exec 7>> "$1/.ngn-build-lock"
  if ! perl -MFcntl=:flock -e 'open(my $fd, ">&=", 7) or die "build.sh: $!\n"; exit(flock($fd, LOCK_EX | LOCK_NB) ? 0 : 1)'; then
    echo "build.sh: waiting for another build in $1" >&2
    perl -MFcntl=:flock -e 'open(my $fd, ">&=", 7) or die "build.sh: $!\n"; flock($fd, LOCK_EX) or die "build.sh: $!\n"'
  fi
}
