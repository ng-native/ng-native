/** The Metro a device run starts: once per project, with the test host on, and stopped after. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { metroFor, stopMetro } from './metro-server.ts';

/** A project whose `expo start` is a stand-in server that answers Metro's status. */
function project(): { root: string; started: () => string[]; done: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), 'metro-server-'));
  writeFileSync(path.join(root, 'package.json'), '{}');
  const bin = path.join(root, 'node_modules/expo/bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(root, 'node_modules/expo/package.json'), '{"name":"expo"}');
  const log = path.join(root, 'started.log');
  writeFileSync(log, '');
  writeFileSync(
    path.join(bin, 'cli.js'),
    `const fs = require('fs');
     const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
     fs.appendFileSync(${JSON.stringify(log)}, [process.argv[2], port, process.env.EXPO_PUBLIC_DEVICE_TESTS, process.env.DEVICE_TESTS_COVERAGE ?? '-'].join(' ') + '\\n');
     require('http').createServer((req, res) => res.end('packager-status:running')).listen(port, '127.0.0.1');`,
  );
  return {
    root,
    started: () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe('the Metro a device run starts', () => {
  it('starts once per project, on a free port, with the test host and coverage asked for', async () => {
    const { root, started, done } = project();
    try {
      const [one, two] = await Promise.all([metroFor(root, { coverage: true }), metroFor(root)]);
      assert.equal(one, two, 'one Metro for the project');
      assert.deepEqual(started(), [`start ${one.port} 1 1`]);
      assert.match(await (await fetch(`http://127.0.0.1:${one.port}/status`)).text(), /running/);
    } finally {
      await stopMetro();
      done();
    }
  });

  it('is stopped when the run closes, and started afresh after', async () => {
    const { root, started, done } = project();
    try {
      const first = await metroFor(root);
      await stopMetro();
      await assert.rejects(fetch(`http://127.0.0.1:${first.port}/status`));
      await metroFor(root);
      assert.equal(started().length, 2);
    } finally {
      await stopMetro();
      done();
    }
  });

  it('fails with what it printed when it stops as it starts', async () => {
    const { root, done } = project();
    try {
      writeFileSync(
        path.join(root, 'node_modules/expo/bin/cli.js'),
        "console.error('no app.json'); process.exit(1);",
      );
      await assert.rejects(metroFor(root), /stopped as it started \(status 1\):\nno app.json/);
    } finally {
      await stopMetro();
      done();
    }
  });
});
