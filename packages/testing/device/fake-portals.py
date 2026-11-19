#!/usr/bin/env python3
"""The fake system UI of a Linux test launch: a stand-in for the XDG desktop portal on the launch's
own session bus, so a call that would show a file chooser, a notification or an app chooser answers
with no one there, and a test can see what was asked and say what a person would have answered.

    fake-portals.py <control folder>

It owns org.freedesktop.portal.Desktop and implements, as xdg-desktop-portal does (a method that
makes a Request returns its object path, and the Response signal follows on it):

- org.freedesktop.portal.FileChooser: OpenFile, SaveFile, SaveFiles.
- org.freedesktop.portal.OpenURI: OpenURI, OpenFile, OpenDirectory.
- org.freedesktop.portal.Notification: AddNotification, RemoveNotification, and the ActionInvoked
  signal, which a test sends.

Any other portal interface (Settings, Location, ...) is not offered, so a caller sees an unknown
method, the answer it gets where no portal runs that interface.

The control folder is the whole interface between the fake and a test. All of it is JSON, a line at
a time where it is a log:

- `ready`: created once the name is owned.
- `calls.jsonl`: one line for each call, in order, as {seq, interface, method, args, answer}: its
  arguments as the portal got them (a file descriptor as its index) and the answer it was given.
- `answers.json`: read again at each call, so a test can change it between calls, by writing a new
  file and renaming it over this one (a call that reads half a file gets the default). An object from
  "Interface.Method" (such as "FileChooser.OpenFile") to an answer, {response, results}, or to a
  list of answers, of which each call takes the first and drops it, until none is left. A call with
  no answer gets the default: a file chooser is cancelled (response 1), as a person cancelling it
  would, and a link or a folder opens (response 0). `response` is the portal's own: 0 done, 1 the
  person cancelled, 2 it ended some other way. `results` is the Response's a{sv}: a string, a
  boolean, a whole number (as an int32) or a list of strings keeps its type, and `uris` and `writable` are
  always a list of strings and a boolean.
- `signals.jsonl`: a line a test appends is sent when it is read (every 100 ms), as {signal, args}:
  {"signal": "ActionInvoked", "args": ["<notification id>", "<action>", []]} is a click on a
  notification, with its parameters a list of strings.
"""
import json
import os
import signal
import sys

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

BUS_NAME = "org.freedesktop.portal.Desktop"
OBJECT_PATH = "/org/freedesktop/portal/desktop"
REQUEST = "org.freedesktop.portal.Request"
POLL_MS = 100
# The Response follows the method's return after this, as it does from a real portal that has to ask
# someone, so a caller that has not yet subscribed is not the one that misses it.
RESPONSE_DELAY_MS = 20

FILE_CHOOSER_XML = """
<node><interface name="org.freedesktop.portal.FileChooser">
  <method name="OpenFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="SaveFile"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="SaveFiles"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <property name="version" type="u" access="read"/>
</interface></node>"""

OPEN_URI_XML = """
<node><interface name="org.freedesktop.portal.OpenURI">
  <method name="OpenURI"><arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="OpenFile"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <method name="OpenDirectory"><arg type="s" direction="in"/><arg type="h" direction="in"/><arg type="a{sv}" direction="in"/><arg type="o" direction="out"/></method>
  <property name="version" type="u" access="read"/>
</interface></node>"""

NOTIFICATION_XML = """
<node><interface name="org.freedesktop.portal.Notification">
  <method name="AddNotification"><arg type="s" direction="in"/><arg type="a{sv}" direction="in"/></method>
  <method name="RemoveNotification"><arg type="s" direction="in"/></method>
  <signal name="ActionInvoked"><arg type="s"/><arg type="s"/><arg type="av"/></signal>
  <property name="version" type="u" access="read"/>
</interface></node>"""

REQUEST_XML = """
<node><interface name="org.freedesktop.portal.Request">
  <method name="Close"/>
  <signal name="Response"><arg type="u"/><arg type="a{sv}"/></signal>
</interface></node>"""

# What each interface's Request methods answer when a test has said nothing: a chooser is cancelled
# and a link opens.
DEFAULT_RESPONSE = {"FileChooser": 1, "OpenURI": 0}
VERSIONS = {"FileChooser": 3, "OpenURI": 3, "Notification": 1}


def info(xml):
    return Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0]


def plain(value):
    """A call's arguments as JSON: tuples as lists, bytes as text."""
    if isinstance(value, dict):
        return {str(key): plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item) for item in value]
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    return value


def variant(key, value):
    """One entry of a Response's a{sv}, typed by its key where the portal fixes one, else by JSON."""
    if key == "uris":
        return GLib.Variant("as", [str(item) for item in value])
    if key == "writable":
        return GLib.Variant("b", bool(value))
    if isinstance(value, bool):
        return GLib.Variant("b", value)
    if isinstance(value, int):
        return GLib.Variant("i", value)
    if isinstance(value, list):
        return GLib.Variant("as", [str(item) for item in value])
    return GLib.Variant("s", str(value))


class Fake:
    def __init__(self, folder):
        self.folder = folder
        self.seq = 0
        self.loop = GLib.MainLoop()
        self.connection = None
        self.closed = set()
        # The Request objects registered on the bus, by path, until their Response is sent.
        self.requests = {}
        self.signal_offset = 0
        # GDBus does not own the interface descriptions registered with it.
        self.interfaces = [info(xml) for xml in (FILE_CHOOSER_XML, OPEN_URI_XML, NOTIFICATION_XML, REQUEST_XML)]
        self.request_info = self.interfaces[3]

    def path(self, name):
        return os.path.join(self.folder, name)

    def read_json(self, name, default):
        try:
            with open(self.path(name), "r", encoding="utf-8") as handle:
                return json.load(handle)
        except FileNotFoundError:
            return default
        except ValueError as error:
            # A half-written file is read again at the next call; this one answers the default.
            print("fake-portals: %s is not JSON: %s" % (name, error), file=sys.stderr)
            return default

    def take_answer(self, interface, method):
        """The answer a test set for this call, dropping it from a list, or the default."""
        answers = self.read_json("answers.json", {})
        key = "%s.%s" % (interface, method)
        found = answers.get(key)
        if isinstance(found, list):
            if not found:
                found = None
            else:
                first, rest = found[0], found[1:]
                answers[key] = rest
                self.write_answers(answers)
                found = first
        answer = found if isinstance(found, dict) else {}
        return {
            "response": int(answer.get("response", DEFAULT_RESPONSE.get(interface, 0))),
            "results": answer.get("results", {}),
        }

    def write_answers(self, answers):
        temporary = self.path("answers.json.tmp")
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(answers, handle)
        os.replace(temporary, self.path("answers.json"))

    def record(self, interface, method, args, answer):
        self.seq += 1
        line = {"seq": self.seq, "interface": interface, "method": method, "args": plain(args), "answer": answer}
        with open(self.path("calls.jsonl"), "a", encoding="utf-8") as handle:
            handle.write(json.dumps(line) + "\n")

    def request_path(self, sender, options):
        token = options.get("handle_token") or "ngn_fake_%d" % (self.seq + 1)
        return "%s/request/%s/%s" % (OBJECT_PATH, sender.lstrip(":").replace(".", "_"), token)

    def call(self, connection, sender, object_path, interface_name, method, parameters, invocation):
        try:
            self.answer_call(connection, sender, interface_name, method, parameters, invocation)
        except Exception as error:  # a bug here answers the caller, which would otherwise wait
            print("fake-portals: %s.%s: %r" % (interface_name, method, error), file=sys.stderr)
            invocation.return_dbus_error("org.freedesktop.DBus.Error.Failed", str(error))

    def answer_call(self, connection, sender, interface_name, method, parameters, invocation):
        interface = interface_name.rsplit(".", 1)[1]
        args = parameters.unpack()
        if interface == "Notification":
            self.record(interface, method, args, None)
            invocation.return_value(None)
            return
        answer = self.take_answer(interface, method)
        self.record(interface, method, args, answer)
        handle = self.request_path(sender, args[-1] if isinstance(args[-1], dict) else {})
        self.serve_request(connection, handle)
        invocation.return_value(GLib.Variant("(o)", (handle,)))
        GLib.timeout_add(RESPONSE_DELAY_MS, self.respond, handle, sender, answer)

    def serve_request(self, connection, handle):
        """The Request object a caller can Close before its Response comes."""

        def close(connection, sender, object_path, interface_name, method, parameters, invocation):
            self.closed.add(object_path)
            invocation.return_value(None)

        # A token used again replaces its Request, as a new one for the same path would.
        self.drop_request(connection, handle)
        self.requests[handle] = connection.register_object(handle, self.request_info, close, None, None)

    def drop_request(self, connection, handle):
        registered = self.requests.pop(handle, None)
        if registered is not None:
            connection.unregister_object(registered)

    def respond(self, handle, sender, answer):
        # A Request that was closed never gets its Response; it is gone either way.
        if handle not in self.closed:
            results = {key: variant(key, value) for key, value in answer["results"].items()}
            self.connection.emit_signal(
                sender, handle, REQUEST, "Response", GLib.Variant("(ua{sv})", (answer["response"], results))
            )
        self.closed.discard(handle)
        self.drop_request(self.connection, handle)
        return False

    def property(self, connection, sender, object_path, interface_name, name):
        if name == "version":
            return GLib.Variant("u", VERSIONS[interface_name.rsplit(".", 1)[1]])
        return None

    def send_signals(self):
        """Sends each line a test appended to signals.jsonl since the last look."""
        try:
            with open(self.path("signals.jsonl"), "r", encoding="utf-8") as handle:
                handle.seek(self.signal_offset)
                text = handle.read()
        except FileNotFoundError:
            return True
        # Only whole lines: one still being written is read again next time.
        end = text.rfind("\n") + 1
        self.signal_offset += len(text[:end].encode("utf-8"))
        for line in text[:end].splitlines():
            if line.strip():
                self.send_signal(line)
        return True

    def send_signal(self, line):
        try:
            message = json.loads(line)
            if message["signal"] != "ActionInvoked":
                raise ValueError("only ActionInvoked is sent")
            notification_id, action, parameters = message["args"]
            body = GLib.Variant(
                "(ssav)", (notification_id, action, [GLib.Variant("s", str(item)) for item in parameters])
            )
            self.connection.emit_signal(
                None, OBJECT_PATH, "org.freedesktop.portal.Notification", "ActionInvoked", body
            )
        except (ValueError, KeyError, TypeError) as error:
            print("fake-portals: cannot send %r: %s" % (line, error), file=sys.stderr)

    def acquired(self, connection, name):
        self.connection = connection
        for interface in self.interfaces[:3]:
            connection.register_object(OBJECT_PATH, interface, self.call, self.property, None)
        GLib.timeout_add(POLL_MS, self.send_signals)
        # The name is owned only once the bus says so, and a caller that gets here first would be told
        # nobody is home.
        with open(self.path("ready"), "w", encoding="utf-8"):
            pass

    def lost(self, connection, name):
        print("fake-portals: could not own %s" % BUS_NAME, file=sys.stderr)
        self.loop.quit()

    def run(self):
        os.makedirs(self.folder, exist_ok=True)
        # A log a test reads starts empty, and so does what it said last time.
        for stale in ("ready", "calls.jsonl", "signals.jsonl"):
            try:
                os.remove(self.path(stale))
            except FileNotFoundError:
                pass
        Gio.bus_own_name(
            Gio.BusType.SESSION,
            BUS_NAME,
            Gio.BusNameOwnerFlags.NONE,
            None,
            self.acquired,
            self.lost,
        )
        for number in (signal.SIGTERM, signal.SIGINT):
            GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, number, self.loop.quit)
        self.loop.run()


def main(argv):
    if len(argv) != 2:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    Fake(argv[1]).run()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
