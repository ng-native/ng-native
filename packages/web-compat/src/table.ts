import type { Engine, EngineNode } from '@ng-native/fabric';
import { CELL, ROW } from './elements.ts';
import { isUp } from './window.ts';

/**
 * A table's columns. A row is a flex row of its cells, and a table's cells line up down it: each
 * is as wide as the columns it spans, of as many columns as the table's widest row has. So a
 * row of two cells in a table of seven, a calendar's last week, is two sevenths of it and not
 * all of it, and a cell across four columns is four sevenths with its padding inside that.
 *
 * A cell down several rows is out of its row's flow, as tall as that many of its row, and the
 * cells after it in those rows start past it. See `placed`.
 *
 * A column is as wide as its widest cell asks, and the table's width is shared between the
 * columns in those proportions, which is how a browser lays out a table with no widths given:
 * a narrow column of numbers beside a wide one of names. See `contentShares`.
 *
 * ponytail: worked out when a cell or a row is put in or a span changes, and not when one is
 * taken out or what a cell holds changes: a table keeps its columns until something is added.
 * A table with a cell that has a width of its own, or with nothing to measure, has columns of
 * one width, which is `table-layout: fixed` with no widths given. So has one that says so.
 */
const CELLS = new Set(['td', 'th']);

/** The columns each cell with a `colspan` is across. */
const spans = new WeakMap<EngineNode, number>();
/** The rows each cell with a `rowspan` is down. */
const tall = new WeakMap<EngineNode, number>();
/** The rows and cells put in or changed since each engine's tables were last laid out. */
const changed = new Map<Engine, Set<EngineNode>>();
/** One style a share, so a cell given the share it has is given the object it has. */
const shares = new Map<string, Readonly<Record<string, unknown>>>();

/** `colspan` on a cell: the columns it is across. */
export function spanColumns(node: EngineNode, columns: number, engine: Engine): void {
  if (!CELLS.has(node.tag)) return;
  spans.set(node, columns > 1 ? columns : 1);
  layOutLater(node, engine);
}

/** `rowspan` on a cell: the rows it is down. */
export function spanRows(node: EngineNode, rows: number, engine: Engine): void {
  if (!CELLS.has(node.tag)) return;
  tall.set(node, rows > 1 ? rows : 1);
  layOutLater(node, engine);
}

/** A row or a cell was put in a table. */
export function tableInserted(node: EngineNode, engine: Engine): void {
  if (CELLS.has(node.tag) || node.tag === 'tr') layOutLater(node, engine);
}

/** Lay the tables out once what is being built is built: a cell is made before its row is in. */
function layOutLater(node: EngineNode, engine: Engine): void {
  const waiting = changed.get(engine);
  if (waiting) return void waiting.add(node);
  changed.set(engine, new Set([node]));
  queueMicrotask(() => {
    const nodes = changed.get(engine) ?? [];
    changed.delete(engine);
    // An app destroyed since is committed to no more.
    if (!isUp(engine)) return;
    for (const table of new Set([...nodes].map(tableOf))) layOut(table, engine);
    engine.commit();
  });
}

/** The table a row or a cell is in, or the furthest thing over it where it is in none. */
function tableOf(node: EngineNode): EngineNode {
  let top = node;
  for (let up: EngineNode | null = node; up; up = up.parent) {
    if (up.tag === 'table') return up;
    if (up.nodeKind === 'element') top = up;
  }
  return top;
}

/** The rows of a table, and not those of a table in one of its cells. */
function rowsOf(node: EngineNode, into: EngineNode[] = []): EngineNode[] {
  for (const child of node.childList) {
    if (child.nodeKind !== 'element' || child.tag === 'table') continue;
    if (child.tag === 'tr') into.push(child);
    else if (!CELLS.has(child.tag)) rowsOf(child, into);
  }
  return into;
}

const cellsOf = (row: EngineNode): EngineNode[] =>
  row.childList.filter((child) => child.nodeKind === 'element' && CELLS.has(child.tag));

/**
 * Whether a table says `table-layout: fixed`: its columns are of one width whatever its cells
 * hold, which is how a header in one table and its rows in another are made to line up.
 */
function isFixed(table: EngineNode, engine: Engine): boolean {
  // As a measurement is: of the page as it stands, with what is written so far.
  if (engine.pending) engine.commit();
  const bound = table.props['style'] as Record<string, unknown> | undefined;
  return (bound?.['tableLayout'] ?? table.styleCache?.style['tableLayout']) === 'fixed';
}

/** Where a cell is in its table: its first column, and the columns and rows it is over. */
interface Place {
  readonly cell: EngineNode;
  readonly column: number;
  readonly span: number;
  readonly rows: number;
}

/**
 * Where each cell of each row is. A cell is in the first column that no cell down from a row
 * above is in, which is why a row under a tall cell has a cell fewer than the table has columns.
 */
function placed(rows: EngineNode[][]): Place[][] {
  // The rows each column is still taken for, by a cell down from above.
  const held: number[] = [];
  return rows.map((cells, index) => {
    let at = 0;
    const row = cells.map((cell) => {
      while (held[at]! > 0) at++;
      const place = {
        cell,
        column: at,
        span: spans.get(cell) ?? 1,
        // No further down than the table goes.
        rows: Math.min(tall.get(cell) ?? 1, rows.length - index),
      };
      for (let over = 0; over < place.span; over++) held[at++] = place.rows;
      return place;
    });
    for (let column = 0; column < held.length; column++) held[column] = (held[column] ?? 1) - 1;
    return row;
  });
}

/** A row with a tall cell in it: what that cell is placed in, drawn over the rows it is down. */
const OVER = { ...ROW, position: 'relative', zIndex: 1 };

function layOut(table: EngineNode, engine: Engine): void {
  const rows = table.tag === 'tr' ? [table] : rowsOf(table);
  const places = placed(rows.map(cellsOf));
  const columns = Math.max(0, ...places.flat().map((place) => place.column + place.span));
  if (!columns) return;
  const shared = isFixed(table, engine) ? null : contentShares(places, columns, engine);
  if (!shared && layOutByOwn(table, places, engine)) return;
  const widths =
    shared ?? ownShares(places, engine) ?? new Array<number>(columns).fill(100 / columns);
  // To a thousandth, so that tables of like columns are given one style between them.
  const across = (from: number, to: number) =>
    Math.round(widths.slice(from, to).reduce((sum, width) => sum + width, 0) * 1000) / 1000;
  places.forEach((row, index) => {
    // Where the cells in the row's flow have reached: a cell starts past what is not in it.
    let flowed = 0;
    for (const { cell, column, span, rows: down } of row) {
      const [share, end] = [across(column, column + span), column + span];
      const style =
        down > 1 ? shareOf(share, across(0, column), down) : shareOf(share, across(flowed, column));
      if (cell.defaultStyle !== style) engine.setDefaultStyle(cell, style);
      if (down === 1) flowed = end;
    }
    const style = row.some((place) => place.rows > 1) ? OVER : ROW;
    const held = rows[index]!;
    if (held.defaultStyle === (style === OVER ? ROW : OVER)) engine.setDefaultStyle(held, style);
  });
}

/** A cell as wide as what it holds, while its table's columns are measured. */
const NATURAL: Readonly<Record<string, unknown>> = (() => {
  const { flexBasis: _, ...cell } = CELL;
  return { ...cell, flexGrow: 0, flexShrink: 0 };
})();

/** What a cell's own style says of a property, bound on it or from a stylesheet. */
function ownOf(cell: EngineNode, key: string): unknown {
  const bound = cell.props['style'] as Record<string, unknown> | undefined;
  return bound?.[key] ?? cell.styleCache?.style[key] ?? undefined;
}

const widthOf = (cell: EngineNode): unknown => ownOf(cell, 'width');

/** The least width a cell's own style says, where that is a width and not none. */
function leastOf(cell: EngineNode): unknown {
  const least = ownOf(cell, 'minWidth');
  return least === 'auto' || !Number.parseFloat(String(least)) ? undefined : least;
}

/** Whether a cell's own style says how wide it is, or how wide at least. */
const hasWidth = (cell: EngineNode): boolean =>
  widthOf(cell) != null || leastOf(cell) !== undefined;

/**
 * Columns by the widths their cells are given: a column is as wide as the first cell in it
 * with a width says, for every cell in it, so a heading with a width is over cells of that
 * width. The columns with none share what is left evenly, each no narrower than the first
 * cell in it with a least width says. And the table is no narrower than its columns come to,
 * as a browser's is, which is how a table too wide for its page is one that scrolls. Whether
 * there was such a table to lay out: one with a cell that says either, and none down several
 * rows.
 *
 * ponytail: a cell across columns that do not all say their width in one unit takes a share
 * of what is left for each of them that has no width, and nothing for those that have. Add
 * their widths to its basis if a table is seen with a wide cell over such columns.
 */
function layOutByOwn(table: EngineNode, rows: Place[][], engine: Engine): boolean {
  const places = rows.flat();
  if (places.some((place) => place.rows > 1)) return false;
  const [own, least] = [columnsBy(places, widthOf), columnsBy(places, leastOf)];
  if (![...own, ...least].some((width) => width !== undefined)) return false;
  for (const { cell, column, span } of places) {
    const over = own.slice(column, column + span);
    const style =
      span > 1
        ? acrossOwn(over)
        : own[column] === undefined
          ? sharing(1, least[column])
          : fixedAt(own[column]);
    if (cell.defaultStyle !== style) engine.setDefaultStyle(cell, style);
  }
  const wide = own.reduce<number>((sum, width, column) => sum + points(width ?? least[column]), 0);
  if (table.tag === 'table' && wide > 0 && ownOf(table, 'minWidth') !== wide) {
    engine.setDefaultStyle(table, { ...table.defaultStyle, minWidth: wide });
  }
  return true;
}

/**
 * A cell across several columns: as wide as they come to where each says its width, all in
 * points or all as shares, which a calendar's cell before the first of the month is.
 */
function acrossOwn(over: unknown[]): Readonly<Record<string, unknown>> {
  if (over.every((width) => typeof width === 'number')) {
    return fixedAt(over.reduce<number>((sum, width) => sum + points(width), 0));
  }
  const parts = over.map(percentOf);
  if (parts.every((part) => part !== undefined)) {
    return fixedAt(`${parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)}%`);
  }
  return sharing(over.filter((width) => width === undefined).length || 1);
}

/** A width in points, and nothing of one that is a share. */
const points = (width: unknown): number => (typeof width === 'number' ? width : 0);

/** What each column is given: what the first cell of one column in it that says, says. */
function columnsBy(places: Place[], said: (cell: EngineNode) => unknown): unknown[] {
  const columns = Math.max(0, ...places.map((place) => place.column + place.span));
  const own = new Array<unknown>(columns).fill(undefined);
  for (const { cell, column, span } of places) {
    if (span === 1) own[column] ??= said(cell) ?? undefined;
  }
  return own;
}

/**
 * The share of a table each of its columns takes, by what its cells hold: each cell is laid
 * out as wide as its content and measured, a column is as wide as the widest cell in it, and
 * the shares are those widths as percentages of their sum. Nothing where a cell has a width of
 * its own, or where no cell could be measured: a host with no layout, a table not yet drawn.
 *
 * ponytail: a cell across several columns is not measured, and a column no single cell is in
 * takes the mean of the others. Share a wide cell's width between its columns if a table's
 * columns are ever set by one.
 */
function contentShares(rows: Place[][], columns: number, engine: Engine): number[] | null {
  const cells = rows.flat().map((place) => place.cell);
  if (cells.some(hasWidth)) return null;
  for (const cell of cells) engine.setDefaultStyle(cell, NATURAL);
  engine.commit();
  const widest = new Array<number>(columns).fill(0);
  for (const { cell, column, span } of rows.flat()) {
    if (span > 1) continue;
    engine.measure(cell, ({ width }) => (widest[column] = Math.max(widest[column]!, width)));
  }
  const measured = widest.filter((width) => width > 0);
  if (!measured.length) return null;
  const mean = measured.reduce((sum, width) => sum + width, 0) / measured.length;
  const asked = widest.map((width) => width || mean);
  const total = asked.reduce((sum, width) => sum + width, 0);
  return asked.map((width) => (width / total) * 100);
}

/**
 * The same columns as shares of the table, for one with a cell down several rows, which is
 * placed by shares: a column with a width is that much of the row as it is drawn, and the
 * others share the rest evenly. Nothing where the row cannot be measured.
 *
 * ponytail: the shares are of the row's width when they are worked out, and are not worked out
 * again when it changes.
 */
function ownShares(rows: Place[][], engine: Engine): number[] | null {
  const row = rows[0]?.[0]?.cell.parent;
  let room = 0;
  if (row) engine.measure(row, ({ width }) => (room = width));
  if (!room) return null;
  const own = columnsBy(rows.flat(), widthOf).map((width) =>
    typeof width === 'number' ? (width / room) * 100 : percentOf(width),
  );
  const given = own.filter((width) => width !== undefined);
  if (!given.length || given.length === own.length) return null;
  const rest = Math.max(0, 100 - given.reduce((sum, width) => sum + width, 0));
  return own.map((width) => width ?? rest / (own.length - given.length));
}

const percentOf = (width: unknown): number | undefined =>
  typeof width === 'string' && width.endsWith('%') ? Number.parseFloat(width) : undefined;

/** A cell of a column with a width: that wide, whatever else is in its row. */
function fixedAt(width: unknown): Readonly<Record<string, unknown>> {
  const key = `at ${String(width)}`;
  let style = shares.get(key);
  if (!style) {
    const { flexBasis: _, ...cell } = CELL;
    // And narrower where the row has too little room for its columns, as each cell in it is:
    // a calendar's cells each say they are as wide as the table.
    shares.set(key, (style = { ...cell, flexGrow: 0, width }));
  }
  return style;
}

/**
 * A cell of columns with no width: that many shares of what the others leave of its row, and
 * no narrower than its column is to be.
 */
function sharing(columns: number, least?: unknown): Readonly<Record<string, unknown>> {
  const key = `of ${columns} ${String(least)}`;
  let style = shares.get(key);
  if (!style) {
    const cell = least === undefined ? CELL : { ...CELL, minWidth: least };
    shares.set(key, (style = { ...cell, flexGrow: columns }));
  }
  return style;
}

/**
 * A cell as wide as a share of its row. One that starts past where the cell before it ends has
 * that gap before it. One down several rows is out of its row's flow, where its row would be as
 * tall as it is otherwise: placed in the row, and as tall as that many of it.
 *
 * ponytail: the rows a cell is down are taken to be as tall as its own, which the rows of a
 * heading and of a group are. Measure them if a table is seen whose rows are not.
 */
function shareOf(percent: number, before = 0, down = 1): Readonly<Record<string, unknown>> {
  const key = `${percent} ${before} ${down}`;
  let style = shares.get(key);
  if (!style) {
    // A width and no basis: a basis that is a share comes to nothing on a device, where a
    // width that is one is the share it says.
    const { flexBasis: _, ...cell } = CELL;
    const sized = { ...cell, flexGrow: 0, width: `${percent}%` };
    const where =
      down > 1
        ? { position: 'absolute', top: 0, left: `${before}%`, height: `${down * 100}%` }
        : before > 0 && { marginLeft: `${before}%` };
    shares.set(key, (style = { ...sized, ...where }));
  }
  return style;
}
