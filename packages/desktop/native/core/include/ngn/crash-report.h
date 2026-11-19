// A crash report for a host whose OS keeps none of its own, as macOS keeps one in
// ~/Library/Logs/DiagnosticReports: on a fatal signal (SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT)
// the host writes `crash.txt`, naming the signal and the native stack, and the same lines to its
// standard error, then dies of the signal as it would have. A test launch's report is in its state
// folder, where the launcher looks for it when the host is lost.
#pragma once

#include <functional>
#include <optional>
#include <string>

namespace ngn {

// The account's home folder in the password database, for a process started without HOME.
std::optional<std::string> accountHomeDirectory();

// Where the report goes: `<stateDir>/crash.txt` for a test launch, else
// `$XDG_STATE_HOME/<appId>/crash.txt`, with `~/.local/state` for an unset XDG_STATE_HOME. The home
// folder is HOME, else `accountHome`'s, else the temporary folder. Resolved before a crash, as the
// signal handler can look nothing up.
std::string crashReportPath(
    const std::string &appId,
    const std::optional<std::string> &testStateDir,
    const std::function<std::optional<std::string>(const std::string &name)> &env,
    const std::function<std::optional<std::string>()> &accountHome = accountHomeDirectory);

// Makes the report's folder and handles the fatal signals from now on, on a stack of their own, so
// a stack overflow is reported too. `program` heads the report. Once for the process.
void installCrashReport(const std::string &path, const std::string &program);

} // namespace ngn
