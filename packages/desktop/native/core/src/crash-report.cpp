#include "ngn/crash-report.h"

#include <execinfo.h>
#include <fcntl.h>
#include <pwd.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cstdlib>
#include <cstring>
#include <filesystem>

namespace ngn {

namespace {

// What the handler reads, set before it is installed: it may only make async-signal-safe calls.
char gPath[4096];
char gProgram[256];

constexpr int kSignals[] = {SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT};

const char *signalName(int signal) {
  switch (signal) {
    case SIGSEGV: return "SIGSEGV";
    case SIGBUS: return "SIGBUS";
    case SIGILL: return "SIGILL";
    case SIGFPE: return "SIGFPE";
    case SIGABRT: return "SIGABRT";
  }
  return "a fatal signal";
}

void put(int fd, const char *text) {
  size_t length = std::strlen(text);
  while (length > 0) {
    ssize_t n = write(fd, text, length);
    if (n <= 0) {
      return;
    }
    text += n;
    length -= static_cast<size_t>(n);
  }
}

// The signal's number, written without the heap.
void putNumber(int fd, int value) {
  char digits[16];
  int at = sizeof digits;
  digits[--at] = '\0';
  unsigned v = value < 0 ? 0u : static_cast<unsigned>(value);
  do {
    digits[--at] = static_cast<char>('0' + v % 10);
    v /= 10;
  } while (v > 0 && at > 0);
  put(fd, digits + at);
}

void report(int fd, int signal, void *const *frames, int count) {
  put(fd, gProgram);
  put(fd, " crashed: ");
  put(fd, signalName(signal));
  put(fd, " (signal ");
  putNumber(fd, signal);
  put(fd, ")\nNative stack:\n");
  backtrace_symbols_fd(frames, count, fd);
}

void onFatalSignal(int signal) {
  void *frames[64];
  int count = backtrace(frames, 64);
  int fd = open(gPath, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd >= 0) {
    report(fd, signal, frames, count);
    close(fd);
  }
  report(STDERR_FILENO, signal, frames, count);
  put(STDERR_FILENO, "The crash report is at ");
  put(STDERR_FILENO, gPath);
  put(STDERR_FILENO, "\n");
  // The signal kills the process now, as it would have, whatever other handler called this one.
  struct sigaction fallback{};
  fallback.sa_handler = SIG_DFL;
  sigemptyset(&fallback.sa_mask);
  sigaction(signal, &fallback, nullptr);
  raise(signal);
}

} // namespace

std::optional<std::string> accountHomeDirectory() {
  const passwd *account = getpwuid(getuid());
  if (!account || !account->pw_dir || !*account->pw_dir) {
    return std::nullopt;
  }
  return std::string(account->pw_dir);
}

std::string crashReportPath(
    const std::string &appId,
    const std::optional<std::string> &testStateDir,
    const std::function<std::optional<std::string>(const std::string &name)> &env,
    const std::function<std::optional<std::string>()> &accountHome) {
  if (testStateDir) {
    return *testStateDir + "/crash.txt";
  }
  std::string state;
  if (auto xdg = env("XDG_STATE_HOME"); xdg && !xdg->empty()) {
    state = *xdg;
  } else {
    auto home = env("HOME");
    if (!home || home->empty()) {
      home = accountHome();
    }
    if (!home || home->empty()) {
      std::error_code ignored;
      home = std::filesystem::temp_directory_path(ignored).string();
    }
    state = *home + "/.local/state";
  }
  return state + "/" + appId + "/crash.txt";
}

void installCrashReport(const std::string &path, const std::string &program) {
  std::error_code ignored;
  std::filesystem::create_directories(std::filesystem::path(path).parent_path(), ignored);
  std::strncpy(gPath, path.c_str(), sizeof gPath - 1);
  std::strncpy(gProgram, program.c_str(), sizeof gProgram - 1);
  // backtrace loads its unwinder the first time it runs, which must not happen in the handler.
  void *warm[1];
  backtrace(warm, 1);
  static char alternate[64 * 1024];
  stack_t stack{};
  stack.ss_sp = alternate;
  stack.ss_size = sizeof alternate;
  sigaltstack(&stack, nullptr);
  struct sigaction action{};
  action.sa_handler = onFatalSignal;
  action.sa_flags = SA_ONSTACK | SA_RESETHAND;
  sigemptyset(&action.sa_mask);
  for (int signal : kSignals) {
    sigaction(signal, &action, nullptr);
  }
}

} // namespace ngn
