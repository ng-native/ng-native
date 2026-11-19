#!/usr/bin/env python3
"""Launches the GTK host on a bundle and reads its accessibility tree over AT-SPI, as a screen
reader reads it, with no screen reader: the host's window, and each role named in it with a name.
Fails when the host exits, draws no first frame, or the tree lacks a role. Prints the tree.
With --tab, it then presses Tab, as a keyboard user does, and fails unless a node in the host's
window says it is focused: the core's Tab order reached a real GTK widget that AT-SPI reports.

    dbus-run-session -- atspi-check.py <ngn-linux> <bundle.js> [--role "push button"]... [--tab]

Needs a display (Xvfb) and pyatspi. A test launch, as launch-probe.sh starts one: the host keeps its
state in a new directory and shows no system prompt.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

import pyatspi


def walk(node, depth, out):
    try:
        focused = node.getState().contains(pyatspi.STATE_FOCUSED)
        out.append((depth, node.getRoleName() + (" (focused)" if focused else ""), node.name or ""))
        for i in range(node.childCount):
            walk(node.getChildAtIndex(i), depth + 1, out)
    except Exception as error:  # A node can go as it is read.
        out.append((depth, "error", str(error)))


def host_tree(pid):
    """The host's windows and everything under them, found by its process (GTK 4.12 gives a window
    no name over AT-SPI), or nothing until AT-SPI has them."""
    for app in pyatspi.Registry.getDesktop(0):
        try:
            if app is None or app.get_process_id() != pid or app.childCount == 0:
                continue
        except Exception:  # An application can go as it is read.
            continue
        out = []
        for i in range(app.childCount):
            walk(app.getChildAtIndex(i), 0, out)
        return out
    return None


def print_tree(tree, stream):
    for depth, role, name in tree:
        print("%s%s %r" % ("  " * depth, role, name), file=stream)


def check_tab(host, deadline, fail):
    """Points into the window, so GTK takes it as active with no window manager, then presses Tab
    until a node is focused."""
    pyatspi.Registry.generateMouseEvent(200, 200, pyatspi.MOUSE_ABS)
    tree = None
    while time.time() < deadline:
        pyatspi.Registry.generateKeyboardEvent(0xFF09, None, pyatspi.KEY_SYM)  # Tab
        time.sleep(1)
        tree = host_tree(host.pid) or []
        focused = [(r, n) for _, r, n in tree if r.endswith(" (focused)")]
        if focused:
            print_tree(tree, sys.stdout)
            print("atspi-check: Tab focused %s %r" % (focused[0][0].split(" (")[0], focused[0][1]))
            return 0
    return fail("no node in the host's window was focused after Tab", tree)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("host")
    parser.add_argument("bundle")
    parser.add_argument("--role", action="append", default=[], help="an AT-SPI role name the tree must hold, named")
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--tab", action="store_true", help="press Tab and require a focused node")
    args = parser.parse_args()

    # The registry the host's GTK and pyatspi both find through the session bus.
    launcher = subprocess.Popen(["/usr/libexec/at-spi-bus-launcher", "--launch-immediately"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    work = tempfile.mkdtemp()
    os.mkdir(os.path.join(work, "state"))
    env = dict(os.environ, NGN_TESTS="1", NGN_STATE_DIR=os.path.join(work, "state"), NGN_RUN_ID="atspi-%d" % os.getpid(),
               NGN_TESTS_FAKE_SYSTEM_UI="1")
    env.pop("GTK_A11Y", None)
    log_path = os.path.join(work, "host.log")
    log = open(log_path, "w")
    host = subprocess.Popen([args.host, args.bundle, "--title", "AT-SPI check"], stdout=log, stderr=subprocess.STDOUT,
                            env=env)

    def fail(message, tree=None):
        print("atspi-check: " + message, file=sys.stderr)
        print_tree(tree or [], sys.stderr)
        print("--- host log ---", file=sys.stderr)
        with open(log_path) as text:
            sys.stderr.write(text.read())
        return 1

    try:
        deadline = time.time() + args.seconds
        tree = None
        missing = args.role
        while time.time() < deadline:
            if host.poll() is not None:
                return fail("the host exited (%d)" % host.returncode)
            with open(log_path) as text:
                drawn = "[ngn] first frame" in text.read()
            tree = host_tree(host.pid) if drawn else None
            missing = [role for role in args.role if not any(r.split(" (")[0] == role and n for _, r, n in tree or [])]
            if tree and not missing:
                if args.tab:
                    return check_tab(host, deadline, fail)
                print_tree(tree, sys.stdout)
                print("atspi-check: %d nodes, with %s" % (len(tree), ", ".join(args.role) or "a window"))
                return 0
            time.sleep(0.5)
        if not tree:
            return fail("the host's window was not on AT-SPI within %ds" % args.seconds)
        return fail("no named %s in the host's tree within %ds" % (", ".join(missing), args.seconds), tree)
    finally:
        host.terminate()
        host.wait()
        launcher.terminate()
        launcher.wait()
        log.close()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
