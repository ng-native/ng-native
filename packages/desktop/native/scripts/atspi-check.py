#!/usr/bin/env python3
"""Launches the GTK host on a bundle and reads its accessibility tree over AT-SPI, as a screen
reader reads it, with no screen reader: the host's window, and each role named in it with a name.
Fails when the host exits, draws no first frame, or the tree lacks a role. Prints the tree.
With --tab, it then presses Tab, as a keyboard user does, and fails unless a node in the host's
window says it is focused: the core's Tab order reached a real GTK widget that AT-SPI reports.
With --relation, a node must have that relation (as AT-SPI names it: "described-by",
"labelled-by") to a node with a name: a view's `aria-describedby` or `aria-labelledby` reached GTK.
With --heading, a heading must have that level (`aria-level`). With --announce, the node with that
name is pressed through its AT-SPI action, as a screen reader presses it, and the host
must send an announcement (`Accessibility.announce()` or a live region). GTK announces from 4.14 and
says a heading's level over AT-SPI from 4.16; below those each is skipped, saying so. --url opens the
app there.

    dbus-run-session -- atspi-check.py <ngn-linux> <bundle.js> [--url <link>] [--role "push button"]...
        [--relation described-by]... [--heading 2] [--announce <name>] [--tab]

GTK 4 answers AT-SPI's Component.GrabFocus with NotSupported, in every release, so a screen reader
cannot move the keyboard focus in a GTK 4 app and there is nothing here to check it with.

Needs a display (Xvfb) and pyatspi. A test launch, as launch-probe.sh starts one: the host keeps its
state in a new directory and shows no system prompt.
"""
import argparse
import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
import time

import pyatspi


RELATIONS = {pyatspi.RELATION_LABELLED_BY: "labelled-by", pyatspi.RELATION_DESCRIBED_BY: "described-by"}


def relations_of(node):
    """The node's labelled-by and described-by relations, as (kind, target's name)."""
    found = []
    for relation in node.getRelationSet():
        kind = RELATIONS.get(relation.getRelationType())
        for i in range(relation.getNTargets() if kind else 0):
            found.append((kind, relation.getTarget(i).name or ""))
    return found


def walk(node, depth, out):
    try:
        focused = node.getState().contains(pyatspi.STATE_FOCUSED)
        out.append((depth, node.getRoleName() + (" (focused)" if focused else ""), node.name or "",
                    relations_of(node)))
        for i in range(node.childCount):
            walk(node.getChildAtIndex(i), depth + 1, out)
    except Exception as error:  # A node can go as it is read.
        out.append((depth, "error", str(error), []))


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


def gtk_minor():
    """The minor version of the GTK 4 the host loads, as this process finds the same library."""
    try:
        return ctypes.CDLL("libgtk-4.so.1").gtk_get_minor_version()
    except OSError:
        return 0


def host_nodes(pid):
    """Every node in the host's windows, as live AT-SPI objects, in tree order."""
    found = []

    def visit(node):
        found.append(node)
        for i in range(node.childCount):
            visit(node.getChildAtIndex(i))

    for app in pyatspi.Registry.getDesktop(0):
        try:
            if app is not None and app.get_process_id() == pid:
                for i in range(app.childCount):
                    visit(app.getChildAtIndex(i))
        except Exception:  # A node can go as it is read.
            continue
    return found


def first(pid, test):
    for node in host_nodes(pid):
        try:
            if test(node):
                return node
        except Exception:
            continue
    return None


def pump(seconds):
    """Runs GLib's main context for a while, which delivers AT-SPI's events to their listeners."""
    from gi.repository import GLib

    context = GLib.MainContext.default()
    end = time.time() + seconds
    while time.time() < end:
        while context.pending():
            context.iteration(False)
        time.sleep(0.05)


def check_heading(host, level, deadline):
    """A heading whose AT-SPI attributes say `level`."""
    want = "level:%d" % level
    while time.time() < deadline:
        heading = first(host.pid, lambda n: n.getRoleName() == "heading" and want in n.getAttributes())
        if heading:
            print("atspi-check: heading %r at %s" % (heading.name, want))
            return None
        time.sleep(0.5)
    return "no heading at %s" % want


def check_announce(host, name, deadline):
    """Presses the node named `name` through its first AT-SPI action, then waits for the host to
    announce something."""
    said = []
    listener = lambda event: said.append(str(event.any_data))
    pyatspi.Registry.registerEventListener(listener, "object:announcement")
    try:
        node = first(host.pid, lambda n: n.name == name and n.queryAction().nActions > 0)
        if node is None:
            return "no node named %r with an action" % name
        node.queryAction().doAction(0)
        while time.time() < deadline and not said:
            pump(0.5)
        if not said:
            return "pressing %r announced nothing" % name
        print("atspi-check: pressing %r announced %r" % (name, said[0]))
        return None
    finally:
        pyatspi.Registry.deregisterEventListener(listener, "object:announcement")


def print_tree(tree, stream):
    for depth, role, name, relations in tree:
        said = "".join(" [%s %r]" % relation for relation in relations)
        print("%s%s %r%s" % ("  " * depth, role, name, said), file=stream)


def check_tab(host, deadline, fail):
    """Points into the window, so GTK takes it as active with no window manager, then presses Tab
    until a node is focused."""
    pyatspi.Registry.generateMouseEvent(200, 200, pyatspi.MOUSE_ABS)
    tree = None
    while time.time() < deadline:
        pyatspi.Registry.generateKeyboardEvent(0xFF09, None, pyatspi.KEY_SYM)  # Tab
        time.sleep(1)
        tree = host_tree(host.pid) or []
        focused = [(r, n) for _, r, n, _ in tree if r.endswith(" (focused)")]
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
    parser.add_argument("--relation", action="append", default=[],
                        help="an AT-SPI relation (described-by, labelled-by) some node must have to a named node")
    parser.add_argument("--heading", type=int, help="a heading level the tree must hold (GTK 4.16 and later)")
    parser.add_argument("--announce", metavar="NAME", help="press the node NAME and require an announcement (GTK 4.14 and later)")
    parser.add_argument("--url", help="the link the app opens at")
    args = parser.parse_args()
    # GTK announces from 4.14 and gives a heading's level over AT-SPI from 4.16.
    minor = gtk_minor()
    for flag, since in (("heading", 16), ("announce", 14)):
        if getattr(args, flag) is not None and minor < since:
            print("atspi-check: --%s skipped: GTK 4.%d is below 4.%d" % (flag, minor, since))
            setattr(args, flag, None)

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
    command = [args.host, args.bundle, "--title", "AT-SPI check"] + (["--url", args.url] if args.url else [])
    host = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=env)

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
            missing = [role for role in args.role if not any(r.split(" (")[0] == role and n for _, r, n, _ in tree or [])]
            missing += ["%s relation" % kind for kind in args.relation
                        if not any(k == kind and target for *_, relations in tree or [] for k, target in relations)]
            if tree and not missing:
                print_tree(tree, sys.stdout)
                print("atspi-check: %d nodes, with %s" % (len(tree), ", ".join(args.role + args.relation) or "a window"))
                checks = []
                if args.heading is not None:
                    checks.append(lambda: check_heading(host, args.heading, deadline))
                if args.announce:
                    checks.append(lambda: check_announce(host, args.announce, deadline))
                for check in checks:
                    failed = check()
                    if failed:
                        return fail(failed, host_tree(host.pid))
                if args.tab:
                    return check_tab(host, deadline, fail)
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
