// ProcessLauncher over posix_spawn: no shell, the environment given and nothing else, a pipe for
// each standard stream read on threads of their own, and the exit reported once both pipes close.
// Stdin is non-blocking and never raises SIGPIPE: a write queues what the pipe cannot take yet, and
// a thread of the program's own drains it, so the JavaScript thread never waits on a program.
#include "ngn/processes.h"

#include <cerrno>
#include <csignal>
#include <cstring>
#include <deque>
#include <poll.h>
#include <fcntl.h>
#include <mutex>
#include <spawn.h>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>

namespace ngn {

namespace {

class PosixLauncher final : public ProcessLauncher, public std::enable_shared_from_this<PosixLauncher> {
 public:
  void setEvents(Events events) override {
    std::lock_guard lock(mutex_);
    events_ = std::make_shared<Events>(std::move(events));
  }

  std::variant<int, std::string> spawn(
      const std::string &path,
      const std::vector<std::string> &args,
      const std::optional<std::string> &cwd,
      const std::map<std::string, std::string> &env) override {
    int in[2], out[2], err[2];
    if (pipe(in) != 0 || pipe(out) != 0 || pipe(err) != 0) {
      return std::string("could not make pipes: ") + std::strerror(errno);
    }
    for (int fd : {in[1], out[0], err[0]}) {
      fcntl(fd, F_SETFD, FD_CLOEXEC);
    }
    fcntl(in[1], F_SETFL, fcntl(in[1], F_GETFL) | O_NONBLOCK);
#ifdef F_SETNOSIGPIPE
    // A write to a program that closed its stdin fails with EPIPE rather than ending the host.
    fcntl(in[1], F_SETNOSIGPIPE, 1);
#endif
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, in[0], 0);
    posix_spawn_file_actions_adddup2(&actions, out[1], 1);
    posix_spawn_file_actions_adddup2(&actions, err[1], 2);
    if (cwd) {
      posix_spawn_file_actions_addchdir_np(&actions, cwd->c_str());
    }
    posix_spawnattr_t attributes;
    posix_spawnattr_init(&attributes);
    sigset_t none, all;
    sigemptyset(&none);
    sigfillset(&all);
    posix_spawnattr_setsigmask(&attributes, &none);
    posix_spawnattr_setsigdefault(&attributes, &all);
    short flags = POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF;
#ifdef __APPLE__
    // Only the three streams reach the program, none of the host's other descriptors.
    flags |= POSIX_SPAWN_CLOEXEC_DEFAULT;
#endif
    posix_spawnattr_setflags(&attributes, flags);

    std::vector<std::string> argStrings{path};
    argStrings.insert(argStrings.end(), args.begin(), args.end());
    std::vector<char *> argv;
    for (auto &a : argStrings) {
      argv.push_back(a.data());
    }
    argv.push_back(nullptr);
    std::vector<std::string> envStrings;
    for (const auto &[name, value] : env) {
      envStrings.push_back(name + "=" + value);
    }
    std::vector<char *> envp;
    for (auto &e : envStrings) {
      envp.push_back(e.data());
    }
    envp.push_back(nullptr);

    pid_t pid = 0;
    int status = posix_spawn(&pid, path.c_str(), &actions, &attributes, argv.data(), envp.data());
    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attributes);
    close(in[0]);
    close(out[1]);
    close(err[1]);
    if (status != 0) {
      close(in[1]);
      close(out[0]);
      close(err[0]);
      return path + " did not start: " + std::strerror(status);
    }

    int handle;
    std::shared_ptr<Events> events;
    {
      std::lock_guard lock(mutex_);
      handle = ++next_;
      running_[handle] = {pid, std::make_shared<Stdin>(in[1])};
      events = events_;
    }
    auto self = shared_from_this();
    std::thread([self, handle, pid, outFd = out[0], errFd = err[0], events] {
      std::thread errReader([&] { read(errFd, handle, true, events); });
      read(outFd, handle, false, events);
      errReader.join();
      int status = 0;
      while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
      }
      self->finished(handle);
      if (events && events->exit) {
        if (WIFSIGNALED(status)) {
          events->exit(handle, std::nullopt, signalName(WTERMSIG(status)));
        } else {
          events->exit(handle, WEXITSTATUS(status), std::nullopt);
        }
      }
    }).detach();
    return handle;
  }

  void write(int handle, const std::string &data) override {
    if (auto in = stdinOf(handle)) {
      in->write(data);
    }
  }

  void closeStdin(int handle) override {
    if (auto in = stdinOf(handle)) {
      in->close();
    }
  }

  int lastHandle() const override {
    std::lock_guard lock(mutex_);
    return next_;
  }

  void killAll(int signal) override {
    std::lock_guard lock(mutex_);
    for (const auto &[handle, running] : running_) {
      ::kill(running.pid, signal);
    }
  }

  void kill(int handle, int signal) override {
    std::lock_guard lock(mutex_);
    if (auto it = running_.find(handle); it != running_.end()) {
      ::kill(it->second.pid, signal);
    }
  }

 private:
  // A program's stdin: what the pipe has not taken yet, written by a thread of its own that runs
  // only while there is some. Closing waits for that to drain; a broken pipe drops the rest.
  class Stdin : public std::enable_shared_from_this<Stdin> {
   public:
    explicit Stdin(int fd) : fd_(fd) {}
    ~Stdin() {
      if (fd_ >= 0) {
        ::close(fd_);
      }
    }

    void write(const std::string &data) {
      std::lock_guard lock(mutex_);
      if (fd_ < 0 || closing_ || data.empty()) {
        return;
      }
      pending_.push_back(data);
      flushLocked();
      if (!pending_.empty() && !draining_) {
        draining_ = true;
        std::thread([self = shared_from_this()] { self->drain(); }).detach();
      }
    }

    void close() {
      std::lock_guard lock(mutex_);
      closing_ = true;
      if (pending_.empty() && fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
      }
    }

   private:
    // Writes what the pipe takes now, without blocking.
    void flushLocked() {
      while (!pending_.empty() && fd_ >= 0) {
        auto &front = pending_.front();
        auto n = ::write(fd_, front.data() + offset_, front.size() - offset_);
        if (n < 0 && errno == EINTR) {
          continue;
        }
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
          return;
        }
        if (n <= 0) {
          // EPIPE: the program stopped reading. What is left can never be read.
          pending_.clear();
          offset_ = 0;
          return;
        }
        offset_ += static_cast<size_t>(n);
        if (offset_ == front.size()) {
          pending_.pop_front();
          offset_ = 0;
        }
      }
    }

    void drain() {
      while (true) {
        int fd;
        {
          std::lock_guard lock(mutex_);
          flushLocked();
          if (pending_.empty() || fd_ < 0) {
            draining_ = false;
            if (closing_ && fd_ >= 0) {
              ::close(fd_);
              fd_ = -1;
            }
            return;
          }
          fd = fd_;
        }
        // Waits for room in the pipe, or for the program to go, outside the lock.
        pollfd ready{.fd = fd, .events = POLLOUT, .revents = 0};
        poll(&ready, 1, 1000);
      }
    }

    std::mutex mutex_;
    int fd_;
    std::deque<std::string> pending_;
    size_t offset_{0};
    bool closing_{false};
    bool draining_{false};
  };

  struct Running {
    pid_t pid;
    std::shared_ptr<Stdin> in;
  };

  std::shared_ptr<Stdin> stdinOf(int handle) {
    std::lock_guard lock(mutex_);
    auto it = running_.find(handle);
    return it == running_.end() ? nullptr : it->second.in;
  }

  static void read(int fd, int handle, bool isStderr, const std::shared_ptr<Events> &events) {
    char buffer[8192];
    while (true) {
      auto n = ::read(fd, buffer, sizeof buffer);
      if (n < 0 && errno == EINTR) {
        continue;
      }
      if (n <= 0) {
        break;
      }
      if (events && events->output) {
        events->output(handle, isStderr, std::string(buffer, static_cast<size_t>(n)));
      }
    }
    close(fd);
  }

  static std::string signalName(int signal) {
    switch (signal) {
      case SIGTERM: return "SIGTERM";
      case SIGINT: return "SIGINT";
      case SIGKILL: return "SIGKILL";
      case SIGHUP: return "SIGHUP";
      case SIGSEGV: return "SIGSEGV";
      case SIGABRT: return "SIGABRT";
      case SIGPIPE: return "SIGPIPE";
      default: return "SIG" + std::to_string(signal);
    }
  }

  void finished(int handle) {
    std::lock_guard lock(mutex_);
    if (auto it = running_.find(handle); it != running_.end()) {
      it->second.in->close();
      running_.erase(it);
    }
  }

  mutable std::mutex mutex_;
  std::shared_ptr<Events> events_;
  std::map<int, Running> running_;
  int next_{0};
};

} // namespace

std::shared_ptr<ProcessLauncher> makePosixLauncher() {
  return std::make_shared<PosixLauncher>();
}

} // namespace ngn
