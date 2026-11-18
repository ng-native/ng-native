---
title: Processes
summary: A desktop app's environment, and the programs it declares, run with spawn.
---

# Processes

`Processes` holds what a desktop OS gives an app and a phone does not: the environment variables it
was started with, in `env`, and `spawn`, which runs a program the app declares. On iOS, Android
and the web it is absent: `available()` is `false`, `env` is empty and `spawn` resolves `null`.

<!-- platforms: Processes, Shell -->

```ts
import { Component, inject } from '@angular/core';
import { Text } from '@ng-native/components';
import { Processes } from '@ng-native/device';

@Component({ selector: 'app-about', imports: [Text], template: `<text>{{ home }}</text>` })
export class About {
  private readonly processes = inject(Processes);
  protected readonly home = this.processes.env['HOME'] ?? '';
}
```

`env` is read once, as the service is made, and cannot be changed. It holds only the variables the
app declares in `capabilities.env`.

## Running a program

`spawn(program, args, { cwd, env })` runs a program, never through a shell, and resolves to a
handle on it: `onStdout` and `onStderr` hear its output, `write` and `end` feed its standard input,
`kill` stops it, and `exit` settles with its exit code or the signal that stopped it.

```ts
const git = await this.processes.spawn('git', ['status', '--porcelain'], { cwd: repo });
git?.onStdout((chunk) => this.output.update((text) => text + chunk));
const { code } = (await git?.exit) ?? { code: null };
```

Every call has to match a capability the app declares in the `@ng-native/desktop` plugin options
in `app.json`. One that does not throws `UndeclaredCapabilityError`, and the desktop host checks
the call again before it runs anything.

```json
[
  "@ng-native/desktop",
  {
    "capabilities": {
      "spawn": [
        { "program": "git", "args": ["status", "--porcelain"] },
        { "program": "/usr/bin/git", "args": ["clone", "{url:https://\\S+}", "{dir:[\\w.-]+}"] },
        { "program": "/usr/bin/git", "args": ["add", "--", "{files:[\\w./-]+}..."] }
      ],
      "env": ["HOME", "LANG", "GIT_DIR"]
    }
  }
]
```

- **`program`** is an absolute path, or a bare name looked for once, at startup, in `/usr/bin`,
  `/bin`, `/usr/sbin`, `/sbin`, `/opt/homebrew/bin` and `/usr/local/bin` on macOS, and in
  `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/local/sbin`, `/usr/sbin` and `/sbin` on Linux, never
  the inherited `PATH`. Inside a Flatpak, the app's own `/app/bin` is looked in first, and a
  program runs inside the sandbox. A name not found, or on macOS a developer tool that is only an
  `xcrun` stub without the Command Line Tools, is absent. Shells, `env`, programs that run their
  arguments as a command (such as `xargs` and `sudo`), programs that leave a sandbox or the session
  on Linux (`flatpak-spawn`, `systemd-run`, `nsenter`, `chroot`, `pkexec` and `busybox`), and
  `.bat` and `.cmd` files are refused.
- **`args`** are literal strings, matched exactly, and `{name:regex}` placeholders. A placeholder's
  pattern matches the whole argument, and it never takes an argument starting with `-` unless each
  alternative of the pattern starts with one (`-v|--verbose`, not `-v|.*`), so an option cannot be
  slipped in where a value was declared. A
  placeholder followed by `...` takes zero or more arguments, each by the same rules; an entry may
  have one.
- **`env`** lists the variables `Processes.env` holds and a spawned program may be given. Any
  other variable in `spawn`'s `env` is left out.

`validateDesktopOptions` and `desktopOptionProblems`, from `@ng-native/device/desktop-options`,
check the options in Node and name where each problem is. The rules guard against bugs and injected
content, not against a hostile app.

## Shell

`Shell` hands a url, a file or a folder to macOS. `openExternal(url)` opens a url in the app the
user chose for its scheme, and refuses `file:`, `javascript:` and `data:` urls. `openPath(path)`
opens a file or folder as a double click in Finder does, and `showItemInFolder(path)` reveals it in
a Finder window. Each resolves to whether macOS took it, and to `false` on every other OS. Both
take only a path the app's `FileSystem` can read (its own folders, the user's picks and the declared
`capabilities.paths`), and resolve to `false` for any other.

## On macOS

`NgNativeProcesses` runs the programs the plugin options' `capabilities` declare, with
`posix_spawn` and never through a shell. The core checks every call again against those
capabilities, from `NGNCapabilities` in a packaged app's `Info.plist` or the `--capabilities` that
`ng-native-desktop run` passes: a program and its arguments must match a `spawn` rule, the program
gets only the `env` variables declared, and its output and exit arrive as `ngNativeProcesses`
events. A Mac App Store (`mas`) build spawns nothing. A spawned program gets SIGTERM when the app
reloads, and every program still running gets SIGKILL when the app quits.

`NgNativeShell` hands a URL, a path or a Finder selection to the OS through NSWorkspace. It refuses
`file:`, script and `data:` URLs, and paths that are not absolute and normalised. `Linking`
refuses the same URLs. `openPath` opens a document in its app and refuses a path that is not
there, a program, an app, a script and a location file, since those would run or follow a link past
the `spawn` rules. `openPath` and `showItemInFolder` take only a path `FileSystem` could read, and
answer false for any other before looking at it.

## Reference

<!-- api: Processes -->
<!-- api: Shell -->
