/**
 * `table-layout`, in a stylesheet read as a browser reads it: one compiled with `generated`, as a
 * library's is. Kept for what lays a table out in `@ng-native/web-compat`, and taken off what a
 * native view is sent. An app's own stylesheet is told it does nothing, as before: nothing of a
 * native view is a table.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';
import { Engine } from '@ng-native/fabric';
import { createFakeFabric } from '@ng-native/testing';

const require = createRequire(import.meta.url);
const { compileCss } = require('@ng-native/metro/css/compile.cjs');

function compiled(css: string, generated: boolean) {
  const reports: string[] = [];
  const sheet = compileCss(css, 'library.css', {
    generated,
    onUnsupported: (message: string) => reports.push(message),
  });
  return { sheet, reports };
}

describe('table-layout', () => {
  it("is kept in a library's sheet, for what lays its table out", () => {
    const { sheet, reports } = compiled(
      '.fixed { table-layout: fixed } .auto { table-layout: auto }',
      true,
    );
    assert.deepEqual(reports, []);
    const fabric = createFakeFabric();
    const engine = new Engine(fabric, 1, { globalStyles: sheet as never });
    const table = engine.createElement('view');
    engine.setClasses(table, 'fixed');
    engine.appendChild(engine.root, table);
    engine.commit();
    assert.equal(table.styleCache?.style['tableLayout'], 'fixed');
    // And nothing a native view is sent.
    assert.equal('tableLayout' in fabric.committed[0]!.props, false);
    engine.setClasses(table, 'auto');
    engine.commit();
    assert.equal(table.styleCache?.style['tableLayout'], 'auto');
  });

  it("is dropped from an app's own sheet, with a report that says so", () => {
    const { reports } = compiled('.fixed { table-layout: fixed }', false);
    assert.match(reports.join('\n'), /dropped 'table-layout'.*no React Native equivalent/);
  });

  it('is dropped where it is a token, which a table is not laid out by', () => {
    const { reports } = compiled('.fixed { table-layout: var(--layout) }', true);
    assert.match(reports.join('\n'), /dropped 'table-layout'/);
  });
});
