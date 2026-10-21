/**
 * A table as a browser lays one out: a row is its cells side by side, and the cells of a table
 * line up in columns, each as wide as the columns it is across, of as many as the widest row has.
 * A calendar's last week of two days is two sevenths of it, and not all of it.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Component, ElementRef, inject, signal } from '@angular/core';
import { Engine } from '@ng-native/fabric';
import { cleanup, compileCss, render, screen, settle } from '@ng-native/testing';
import { provideWebCompat } from './index.ts';

/** A sheet read as a browser reads it, as a library's is. */
const LIBRARY = { generated: true } as object;

/** What a library sees of an element: loosely typed, as its own code would be against the DOM. */
type Dom = any;

afterEach(cleanup);

/** A calendar's month: a cell across the days before the first, and a last week of two days. */
@Component({
  selector: 'x-table',
  template: `
    <table>
      <caption>
        Invoices
      </caption>
      <thead>
        <tr testID="head">
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        <tr testID="row">
          <td testID="cell">$250.00</td>
          <td testID="wide" [attr.colspan]="span()">Wide</td>
          <td testID="fixed" colspan="2">Fixed</td>
        </tr>
        <tr>
          <td testID="short">Short</td>
          <td testID="last">Last</td>
        </tr>
      </tbody>
      <tfoot></tfoot>
    </table>
  `,
})
class Table {
  readonly span = signal<number | null>(4);
}

/** Headings that say how wide their columns are, or how wide at least, over cells that do not. */
@Component({
  template: `
    <table testID="grid">
      <tr>
        <th style="width: 40px">Pick</th>
        <th style="min-width: 200px">Name</th>
      </tr>
      <tr>
        <td testID="tick">x</td>
        <td testID="body">James</td>
      </tr>
    </table>
    <table>
      <tr>
        <td testID="before" colspan="2">Oct</td>
        <td style="width: 25%">1</td>
      </tr>
      <tr>
        <td style="width: 25%">2</td>
        <td style="width: 25%">3</td>
        <td style="width: 25%">4</td>
      </tr>
    </table>
  `,
})
class Headed {}

/** A heading down two rows of headings, and a cell down the rows of its group. */
@Component({
  template: `
    <table>
      <tr id="top" testID="top">
        <th testID="brand" rowspan="2">Brand</th>
        <th testID="rate" colspan="2">Rate</th>
      </tr>
      <tr>
        <th testID="sales">Sales</th>
        <th testID="profits">Profits</th>
      </tr>
      <tr testID="first">
        <td testID="name" [style.width]="narrow()">A</td>
        <td testID="group" [attr.rowspan]="tall()">G</td>
        <td testID="one">1</td>
      </tr>
      <tr>
        <td testID="other">B</td>
        <td testID="two">2</td>
      </tr>
    </table>
  `,
})
class Grouped {
  readonly tall = signal<number | null>(2);
  readonly narrow = signal<string | null>(null);
}

/** A narrow column of numbers beside a wide one of names. */
@Component({
  template: `
    <table [class.fixed]="fixed()">
      <tr>
        <th id="no" testID="no">No.</th>
        <th id="planet" testID="planet">Planet</th>
      </tr>
      <tr>
        <td id="one" testID="one">1</td>
        <td id="mercury" testID="mercury" [style.width]="own()">Mercury</td>
      </tr>
      @for (name of more(); track name) {
        <tr>
          <td>2</td>
          <td>{{ name }}</td>
        </tr>
      }
    </table>
  `,
})
class Planets {
  readonly fixed = signal(false);
  readonly own = signal<string | null>(null);
  readonly more = signal<string[]>([]);
  readonly host: Dom = inject(ElementRef).nativeElement;
}

/** A cell's width as a share of its row, to a hundredth, and whether it grows. */
const share = (id: string) => {
  const { width, flexGrow } = screen.getByTestId(id).props;
  return [Math.round(Number.parseFloat(String(width)) * 100) / 100, flexGrow];
};

describe('a table in an app that asked for web-compat', () => {
  it('lays a row out as its cells side by side, each a block in the middle of its height', async () => {
    await render(Table, { providers: [provideWebCompat()] });
    await settle();
    assert.equal(screen.getByTestId('row').props['flexDirection'], 'row');
    assert.equal(screen.getByTestId('head').props['flexDirection'], 'row');
    // A block's content in the middle of it is a column's along its height.
    assert.equal(screen.getByTestId('cell').props['justifyContent'], 'center');
  });

  it("gives each cell its columns' share of the table's width, whatever its row holds", async () => {
    const app = await render(Table, { providers: [provideWebCompat()] });
    await settle();
    // Seven columns: one, four and two in the first row.
    assert.deepEqual(share('cell'), [14.29, 0]);
    assert.deepEqual(share('wide'), [57.14, 0]);
    assert.deepEqual(share('fixed'), [28.57, 0]);
    assert.deepEqual(share('short'), [14.29, 0]);
    assert.deepEqual(share('last'), [14.29, 0]);
    // Four columns once the wide cell spans one.
    app.instance.span.set(null);
    await settle();
    assert.deepEqual(share('wide'), [25, 0]);
    assert.deepEqual(share('fixed'), [50, 0]);
    assert.deepEqual(share('short'), [25, 0]);
  });

  it('draws a cell down the rows it spans, and keeps the cells of those rows clear of it', async () => {
    const app = await render(Grouped, { providers: [provideWebCompat()] });
    await settle();
    const third = (thirds: number) => Math.round(thirds * 3333.3) / 100;
    const box = (id: string) => {
      const { position, left, width, height, marginLeft, zIndex } = screen.getByTestId(id).props;
      const part = (value: unknown) =>
        value == null ? null : Math.round(Number.parseFloat(String(value)) * 100) / 100;
      return {
        position: position ?? null,
        left: part(left),
        width: part(width),
        height: height ?? null,
        after: part(marginLeft),
        zIndex: zIndex ?? null,
      };
    };
    const plain = { position: null, left: null, height: null, zIndex: null };
    const down = { position: 'absolute', height: '200%', after: null, zIndex: null };
    // A heading down the first column: what follows it, in its row and the next, starts past it.
    assert.deepEqual(box('brand'), { ...down, left: 0, width: third(1) });
    assert.deepEqual(box('rate'), { ...plain, width: third(2), after: third(1) });
    assert.deepEqual(box('sales'), { ...plain, width: third(1), after: third(1) });
    assert.deepEqual(box('profits'), { ...plain, width: third(1), after: null });
    // Drawn over the rows under it, which are drawn after its own.
    assert.equal(box('top').zIndex, 1);
    assert.equal(box('top').position, 'relative');
    // A cell down the middle column: the next row's second cell is in the third column.
    assert.deepEqual(box('group'), { ...down, left: third(1), width: third(1) });
    assert.deepEqual(box('one'), { ...plain, width: third(1), after: third(1) });
    assert.deepEqual(box('other'), { ...plain, width: third(1), after: null });
    assert.deepEqual(box('two'), { ...plain, width: third(1), after: third(1) });
    // And a cell of one row again once it spans no more.
    app.instance.tall.set(null);
    await settle();
    assert.deepEqual(box('group'), { ...plain, width: third(1), after: null });
    assert.deepEqual(box('two'), { ...plain, width: third(1), after: null });
    assert.equal(box('first').zIndex, null);
    // A column with a width is that much of the row, and the others share what is left of it.
    app.fabric.frames.set('top', { x: 0, y: 0, width: 400, height: 40 });
    app.instance.narrow.set('40px');
    app.instance.tall.set(2);
    await settle();
    assert.deepEqual(box('group'), { ...down, left: 10, width: 45 });
    assert.deepEqual(box('one'), { ...plain, width: 45, after: 45 });
    assert.deepEqual(box('sales'), { ...plain, width: 45, after: 10 });
  });

  it('holds a column to the width its heading says, and to the least width it says', async () => {
    await render(Headed, { providers: [provideWebCompat()] });
    await settle();
    const { width, flexGrow } = screen.getByTestId('tick').props;
    assert.deepEqual([width, flexGrow], [40, 0]);
    const body = screen.getByTestId('body').props;
    assert.deepEqual([body['minWidth'], body['flexGrow']], [200, 1]);
    // And the table is no narrower than its columns, so what scrolls it has that far to go.
    assert.equal(screen.getByTestId('grid').props['minWidth'], 240);
    // A cell across columns that each say their share is as wide as those come to, whatever
    // padding it has: a calendar's label before the first of the month.
    const before = screen.getByTestId('before').props;
    assert.deepEqual([before['width'], before['flexGrow']], ['50%', 0]);
  });

  it('shares a table between its columns by what each holds, as a browser does', async () => {
    // Each cell is measured as wide as what it holds, and a column is as wide as its widest: the
    // table's width is shared out in those proportions, where an even share would crowd the
    // names and strand the numbers.
    const app = await render(Planets, { providers: [provideWebCompat()] });
    for (const [id, width] of [
      ['no', 50],
      ['one', 60],
      ['planet', 100],
      ['mercury', 140],
    ] as const) {
      app.fabric.frames.set(id, { x: 0, y: 0, width, height: 40 });
    }
    // Laid out again as a row is put in, which is when a table's columns can change.
    app.instance.more.set(['Venus']);
    await settle();
    // Sixty and a hundred and forty, of two hundred.
    assert.deepEqual(share('no'), [30, 0]);
    assert.deepEqual(share('one'), [30, 0]);
    assert.deepEqual(share('planet'), [70, 0]);
    // A cell with a width of its own says how wide its column is, for the heading over it
    // too, and the columns with none share what is left.
    app.instance.own.set('120px');
    app.instance.more.set(['Venus', 'Earth']);
    await settle();
    assert.deepEqual(share('planet'), [120, 0]);
    assert.deepEqual(share('no'), [Number.NaN, 1]);
    assert.deepEqual(share('one'), [Number.NaN, 1]);
  });

  it('gives a table with a fixed layout columns of one width, whatever its cells hold', async () => {
    // `table-layout: fixed` with no widths given: a header in one table and its rows in
    // another line up, where each sized by what it holds would not.
    const app = await render(Planets, {
      providers: [provideWebCompat()],
      globalStyles: compileCss('.fixed { table-layout: fixed }', 'library', LIBRARY) as never,
    });
    for (const [id, width] of [
      ['no', 50],
      ['one', 60],
      ['planet', 100],
      ['mercury', 140],
    ] as const) {
      app.fabric.frames.set(id, { x: 0, y: 0, width, height: 40 });
    }
    // Said by a library's stylesheet.
    app.instance.fixed.set(true);
    app.instance.more.set(['Venus']);
    await settle();
    const width = (id: string) => Number.parseFloat(String(screen.getByTestId(id).props['width']));
    assert.deepEqual([width('no'), width('planet')], [50, 50]);
    // And by a script, once the sheet no longer says it.
    app.instance.fixed.set(false);
    const table = app.instance.host.querySelector('table');
    table.style.tableLayout = 'fixed';
    app.instance.more.set(['Venus', 'Earth']);
    await settle();
    assert.deepEqual([width('no'), width('planet')], [50, 50]);
    // It is the table layout's to read, and nothing a native view is sent.
    const sent = (view: {
      props: Record<string, unknown>;
      children: readonly unknown[];
    }): boolean => 'tableLayout' in view.props || (view.children as (typeof view)[]).some(sent);
    assert.equal(app.fabric.committed.some(sent), false);
  });
});

describe('a table whose app is destroyed before its columns are counted', () => {
  it('lays nothing out once the app is gone', async () => {
    const app = await render(Table, { providers: [provideWebCompat()] });
    await settle();
    const engine = app.componentRef.injector.get(Engine);
    const document = (globalThis as { document?: Dom }).document!;
    // A row put in by a script: its table is laid out once what is being built is built.
    const row = document.createElement('tr');
    row.appendChild(document.createElement('td'));
    document.querySelector('table').appendChild(row);
    // What a table's layout does: give its cells their columns' styles.
    let laid = 0;
    const give = engine.setDefaultStyle.bind(engine);
    engine.setDefaultStyle = (...args: Parameters<Engine['setDefaultStyle']>) => {
      laid++;
      return give(...args);
    };
    cleanup();
    const destroyed = laid;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(laid, destroyed);
  });
});

describe('a table in an app that did not ask', () => {
  it('lays out none of it', async () => {
    const error = console.error;
    console.error = () => {};
    try {
      await render(Table);
    } finally {
      console.error = error;
    }
    assert.equal(screen.queryByTestId('row')?.props['flexDirection'], undefined);
  });
});
