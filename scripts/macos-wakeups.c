// macos-wakeups <pid> <seconds>: CPU and interrupt wakeups of a process per second over the
// window, from proc_pid_rusage. Unlike top's IDLEW it counts timer wakeups.
// Prints `cpu <percent>` and `wakeups <per second>`, one per line.
#include <libproc.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: macos-wakeups <pid> <seconds>\n");
    return 2;
  }
  int pid = atoi(argv[1]), secs = atoi(argv[2]);
  if (pid <= 0 || secs <= 0) return 2;
  struct rusage_info_v4 a, b;
  if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&a)) { perror("rusage"); return 1; }
  sleep(secs);
  if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&b)) { perror("rusage"); return 1; }
  // ri_user_time and ri_system_time are in mach absolute time units, which are nanoseconds on
  // Intel and 125/3 ns on Apple silicon.
  mach_timebase_info_data_t tb;
  mach_timebase_info(&tb);
  double ns = ((b.ri_user_time + b.ri_system_time) - (a.ri_user_time + a.ri_system_time)) *
              (double)tb.numer / tb.denom;
  printf("cpu %.3f\n", ns / 1e9 / secs * 100);
  printf("wakeups %.2f\n", (b.ri_interrupt_wkups - a.ri_interrupt_wkups) / (double)secs);
  return 0;
}
