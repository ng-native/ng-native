/**
 * The fake system UI of a Linux test launch (`device/fake-portals.py`, started by the launcher's
 * session script): that a call that would show a file chooser, open a link or post a notification
 * is answered with no one there, recorded, and answered as a test says, and that a launch without
 * the tools to fake it fails instead of reaching the session's own portals.
 *
 * Each test runs the launcher's own session script, with a portal client as the host. The fake
 * needs `dbus-daemon` and `python3` with PyGObject, so these tests are skipped where they are
 * missing (a Mac), unless `NGN_REQUIRE_FAKE_SYSTEM_UI` is set, which CI sets in the AlmaLinux 9
 * image, where they are fixed.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  FAKE_PORTALS,
  linuxLauncher,
  linuxStateEnvironment,
  sessionScript,
} from './linux-launcher.ts';

const available =
  process.platform === 'linux' &&
  spawnSync('sh', [
    '-c',
    "command -v dbus-daemon && python3 -c \"import gi; gi.require_version('Gio', '2.0')\"",
  ]).status === 0;
const required = Boolean(process.env['NGN_REQUIRE_FAKE_SYSTEM_UI']);
const skip =
  !available && !required ? 'needs Linux, dbus-daemon and python3 with PyGObject' : false;

/**
 * What the host does in these tests: the calls a portal client makes, each printed as one JSON line
 * with its Response (or the error it got). `argv`: the calls to make, in order, each as
 * `Interface.Method` and, for the notification calls and the signal, the rest of the line.
 */
const CLIENT = `
import json, os, sys
import gi
gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

PORTAL = "org.freedesktop.portal.Desktop"
PATH = "/org/freedesktop/portal/desktop"
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
folder = os.path.join(os.environ["NGN_STATE_DIR"], "portals")


def say(value):
    print(json.dumps(value), flush=True)


def unpack(variant):
    return variant.unpack() if variant is not None else None


tokens = []


def token():
    tokens.append(1)
    return "token%d" % len(tokens)


def request(interface, method, parameters, close=False):
    """Calls a Request method and waits for its Response, or for half a second without one."""
    loop = GLib.MainLoop()
    result = {}

    def responded(connection, sender, path, iface, signal, params):
        result["response"], result["results"] = params.unpack()
        loop.quit()

    bus.signal_subscribe(PORTAL, "org.freedesktop.portal.Request", "Response", None, None,
                         Gio.DBusSignalFlags.NO_MATCH_RULE, responded)
    try:
        reply = bus.call_sync(PORTAL, PATH, "org.freedesktop.portal." + interface, method,
                              parameters, None, Gio.DBusCallFlags.NONE, 5000, None)
    except GLib.Error as error:
        return {"error": error.message}
    handle = reply.unpack()[0]
    if close:
        bus.call_sync(PORTAL, handle, "org.freedesktop.portal.Request", "Close", None, None,
                      Gio.DBusCallFlags.NONE, 5000, None)
    GLib.timeout_add(500, loop.quit)
    loop.run()
    result["handle"] = handle
    return result


def call(arguments):
    kind = arguments[0]
    if kind == "FileChooser.OpenFile":
        options = {"handle_token": GLib.Variant("s", token())}
        return request("FileChooser", "OpenFile", GLib.Variant("(ssa{sv})", ("", "Open", options)))
    if kind == "FileChooser.SaveFile":
        return request("FileChooser", "SaveFile", GLib.Variant("(ssa{sv})", ("", "Save", {})))
    if kind == "OpenURI.OpenURI":
        return request("OpenURI", "OpenURI", GLib.Variant("(ssa{sv})", ("", "https://example.com", {})))
    if kind == "FileChooser.OpenFile.close":
        return request("FileChooser", "OpenFile", GLib.Variant("(ssa{sv})", ("", "Open", {})), close=True)
    if kind == "FileChooser.OpenFile.late":
        done = request("FileChooser", "OpenFile", GLib.Variant("(ssa{sv})", ("", "Open", {})))
        try:
            bus.call_sync(PORTAL, done["handle"], "org.freedesktop.portal.Request", "Close", None, None,
                          Gio.DBusCallFlags.NONE, 5000, None)
        except GLib.Error as error:
            return {"closeError": Gio.dbus_error_get_remote_error(error)}
        return {"closeError": None}
    if kind == "Notification.Add":
        body = {"title": GLib.Variant("s", "Hello")}
        bus.call_sync(PORTAL, PATH, "org.freedesktop.portal.Notification", "AddNotification",
                      GLib.Variant("(sa{sv})", (arguments[1], body)), None, Gio.DBusCallFlags.NONE, 5000, None)
        return {"added": arguments[1]}
    if kind == "Notification.Remove":
        bus.call_sync(PORTAL, PATH, "org.freedesktop.portal.Notification", "RemoveNotification",
                      GLib.Variant("(s)", (arguments[1],)), None, Gio.DBusCallFlags.NONE, 5000, None)
        return {"removed": arguments[1]}
    if kind == "Notification.Click":
        # What a test does: ask for a click, then hear it as the host would.
        loop = GLib.MainLoop()
        heard = []

        def invoked(connection, sender, path, iface, signal, params):
            heard.append(params.unpack())
            loop.quit()

        bus.signal_subscribe(PORTAL, "org.freedesktop.portal.Notification", "ActionInvoked", None, None,
                             Gio.DBusSignalFlags.NONE, invoked)
        with open(os.path.join(folder, "signals.jsonl"), "a") as handle:
            handle.write(json.dumps({"signal": "ActionInvoked", "args": [arguments[1], arguments[2], ["x"]]}) + "\\n")
        GLib.timeout_add(3000, loop.quit)
        loop.run()
        return {"heard": [[a, b, [c.get_string() if hasattr(c, "get_string") else c for c in d]] for a, b, d in heard]}
    if kind == "Settings.ReadAll":
        try:
            bus.call_sync(PORTAL, PATH, "org.freedesktop.portal.Settings", "ReadAll",
                          GLib.Variant("(as)", ([],)), None, Gio.DBusCallFlags.NONE, 5000, None)
        except GLib.Error as error:
            return {"error": Gio.dbus_error_get_remote_error(error)}
        return {"error": None}
    if kind == "version":
        reply = bus.call_sync(PORTAL, PATH, "org.freedesktop.DBus.Properties", "Get",
                              GLib.Variant("(ss)", ("org.freedesktop.portal." + arguments[1], "version")),
                              None, Gio.DBusCallFlags.NONE, 5000, None)
        return {"version": reply.unpack()[0]}
    return {"error": "unknown call " + kind}


for line in json.loads(os.environ["FAKE_CALLS"]):
    say(call(line.split(" ")))
`;

interface Run {
  /** What the client printed, one entry for each call it made. */
  results: Record<string, unknown>[];
  /** The fake's own log of the calls, as the control folder holds it. */
  calls: Record<string, unknown>[];
  status: number | null;
  stderr: string;
}

const lines = (text: string): Record<string, unknown>[] =>
  text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * Runs the client through the launcher's session script, with `answers` in the control folder
 * before the fake starts, as a test sets them.
 */
async function run(calls: string[], answers?: unknown): Promise<Run> {
  const dir = mkdtempSync(path.join(tmpdir(), 'fake-portals-'));
  try {
    const client = path.join(dir, 'client.py');
    writeFileSync(client, CLIENT);
    const state = path.join(dir, 'state');
    mkdirSync(path.join(state, 'portals'), { recursive: true });
    if (answers)
      writeFileSync(path.join(state, 'portals', 'answers.json'), JSON.stringify(answers));
    const child = spawn(
      'bash',
      ['-c', sessionScript('inherit', [], true), 'ngn-test', 'python3', client, ...calls],
      {
        env: {
          ...process.env,
          ...linuxStateEnvironment(state),
          NGN_STATE_DIR: state,
          NGN_FAKE_PORTALS: FAKE_PORTALS,
          FAKE_CALLS: JSON.stringify(calls),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const status = await new Promise<number | null>((resolve) => child.once('close', resolve));
    let logged = '';
    try {
      logged = readFileSync(path.join(state, 'portals', 'calls.jsonl'), 'utf8');
    } catch {
      // No call reached the fake.
    }
    return { results: lines(stdout), calls: lines(logged), status, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the fake desktop portal', { skip }, () => {
  it('cancels a file chooser and opens a link when a test has said nothing, and records both', async () => {
    const out = await run(['FileChooser.OpenFile', 'OpenURI.OpenURI'], undefined);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.results[0]?.['response'], 1, 'a person cancelling');
    assert.equal(out.results[1]?.['response'], 0, 'a link opened');
    assert.deepEqual(
      out.calls.map((call) => [call['interface'], call['method']]),
      [
        ['FileChooser', 'OpenFile'],
        ['OpenURI', 'OpenURI'],
      ],
    );
    assert.deepEqual(out.calls[0]?.['args'], ['', 'Open', { handle_token: 'token1' }]);
    assert.deepEqual(out.calls[1]?.['args'], ['', 'https://example.com', {}]);
    assert.deepEqual(out.calls[0]?.['answer'], { response: 1, results: {} });
    // The Request path is the one the caller's token names, under its own bus name.
    assert.match(String(out.results[0]?.['handle']), /\/request\/[\d_]+\/token1$/);
  });

  it('answers as a test says, and takes a list of answers one a call, then the default', async () => {
    const chosen = {
      response: 0,
      results: { uris: ['file:///tmp/a.txt', 'file:///tmp/b.txt'], writable: true },
    };
    const out = await run(
      [
        'FileChooser.OpenFile',
        'FileChooser.OpenFile',
        'FileChooser.OpenFile',
        'FileChooser.SaveFile',
      ],
      {
        'FileChooser.OpenFile': [chosen, { response: 2 }],
        'FileChooser.SaveFile': { response: 0, results: { uris: ['file:///tmp/out.txt'] } },
      },
    );
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(
      out.results.slice(0, 3).map((result) => result['response']),
      [0, 2, 1],
    );
    assert.deepEqual(out.results[0]?.['results'], {
      uris: ['file:///tmp/a.txt', 'file:///tmp/b.txt'],
      writable: true,
    });
    assert.deepEqual(out.results[3]?.['results'], { uris: ['file:///tmp/out.txt'] });
  });

  it('sends no Response to a Request that was closed', async () => {
    const out = await run(['FileChooser.OpenFile.close']);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.results[0]?.['response'], undefined);
    assert.equal(out.calls.length, 1);
  });

  it('drops a Request once its Response is sent', async () => {
    const out = await run(['FileChooser.OpenFile.late']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      String(out.results[0]?.['closeError']),
      /UnknownMethod|UnknownObject|UnknownInterface/,
    );
  });

  it('records notifications and sends the click a test asks for', async () => {
    const out = await run([
      'Notification.Add n1',
      'Notification.Remove n1',
      'Notification.Click n2 open',
    ]);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(
      out.calls.map((call) => [call['method'], (call['args'] as unknown[])[0]]),
      [
        ['AddNotification', 'n1'],
        ['RemoveNotification', 'n1'],
      ],
    );
    assert.deepEqual(out.results[2]?.['heard'], [['n2', 'open', ['x']]]);
  });

  it('offers only the portals it implements, so Settings is absent as where no portal runs it', async () => {
    const out = await run([
      'Settings.ReadAll',
      'version FileChooser',
      'version OpenURI',
      'version Notification',
    ]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(String(out.results[0]?.['error']), /UnknownMethod|UnknownInterface|UnknownObject/);
    assert.deepEqual(
      out.results.slice(1).map((result) => result['version']),
      [3, 3, 1],
    );
  });
});

describe('the launch without the tools for a fake system UI', { skip }, () => {
  it('fails with a reason instead of running against the session portals', async () => {
    // A PATH with what the session script itself needs, and no dbus-daemon.
    const dir = mkdtempSync(path.join(tmpdir(), 'fake-portals-path-'));
    try {
      const tools = path.join(dir, 'bin');
      mkdirSync(tools);
      for (const tool of ['mkdir', 'mktemp', 'rm', 'cat', 'seq', 'sleep', 'true']) {
        const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' });
        symlinkSync(found.stdout.trim(), path.join(tools, tool));
      }
      const state = path.join(dir, 'state');
      const bash = spawnSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
      const child = spawn(bash, ['-c', sessionScript('inherit', [], true), 'ngn-test', 'true'], {
        env: { ...linuxStateEnvironment(state), NGN_STATE_DIR: state, PATH: tools },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const status = await new Promise((resolve) => child.once('close', resolve));
      assert.equal(status, 70);
      assert.match(stderr, /the fake system UI needs dbus-daemon and python3 with PyGObject/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('linuxLauncher with the fake system UI', { skip }, () => {
  it('runs the host on a bus of its own, with the control folder in its state folder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fake-portals-launch-'));
    try {
      const stateDir = path.join(dir, 'state');
      const client = path.join(dir, 'client.py');
      writeFileSync(client, CLIENT);
      const launcher = linuxLauncher({
        host: spawnSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).stdout.trim(),
        args: [client],
        bundle: '/unused.js',
        container: false,
        display: 'inherit',
        env: {
          DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent/session-bus',
          FAKE_CALLS: JSON.stringify(['FileChooser.OpenFile']),
        },
      });
      const app = await launcher.start({ port: 1, runId: 'fake-ui', stateDir });
      try {
        assert.equal(await app.exited, 'status 0');
        const logged = readFileSync(path.join(stateDir, 'portals', 'calls.jsonl'), 'utf8');
        assert.equal(
          lines(logged)[0]?.['method'],
          'OpenFile',
          "the call reached the fake, not the caller's bus",
        );
      } finally {
        await app.stop();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
