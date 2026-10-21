/**
 * Fixtures Taffy has none of: inline-block boxes, and positioned boxes among flex columns.
 *
 * Markup is written with no whitespace between boxes, as an Angular template compiles: a space
 * between two inline-blocks is a glyph wide in a browser.
 */
const box = (style: string, inside = '') => `<div style="${style}">${inside}</div>`;
const root = (style: string, inside: string) =>
  `<div id="test-root" style="${style}">${inside}</div>`;
const ib = (style: string, inside = '') => box(`display: inline-block; ${style}`, inside);

const INLINE_BLOCK: Record<string, string> = {
  row: root('display: block; width: 200px;', ib('width: 50px; height: 20px;').repeat(3)),
  wraps: root('display: block; width: 120px;', ib('width: 50px; height: 20px;').repeat(3)),
  heights: root(
    'display: block; width: 200px;',
    ib('width: 50px; height: 20px;') +
      ib('width: 50px; height: 40px;') +
      ib('width: 50px; height: 30px;'),
  ),
  heights_wrapped: root(
    'display: block; width: 120px;',
    ib('width: 50px; height: 20px;') +
      ib('width: 50px; height: 40px;') +
      ib('width: 50px; height: 30px;'),
  ),
  margins: root(
    'display: block; width: 200px;',
    ib('width: 50px; height: 20px; margin: 5px 10px;') +
      ib('width: 50px; height: 20px; margin: 15px 0 10px 5px;'),
  ),
  padding_border: root(
    'display: block; width: 200px;',
    ib('width: 50px; height: 20px; padding: 5px; border-width: 2px;').repeat(2),
  ),
  shrink_to_fit: root('display: block; width: 200px;', ib('', box('width: 70px; height: 20px;'))),
  shrink_to_fit_padded: root(
    'display: block; width: 200px;',
    ib('padding: 10px;', box('width: 70px; height: 20px;')) + ib('width: 30px; height: 30px;'),
  ),
  percent_width: root('display: block; width: 200px;', ib('width: 25%; height: 20px;').repeat(3)),
  auto_parent_width: root('display: block;', ib('width: 50px; height: 20px;').repeat(3)),
  text: root('display: block; width: 200px;', ib('', 'XXXX') + ib('', 'XX')),
  text_wraps_inside: root('display: block; width: 60px;', ib('', 'XXXX&ZeroWidthSpace;XXXX')),
  short_line: root('display: block; width: 200px;', ib('width: 50px; height: 4px;')),
  mixed_with_block: root(
    'display: block; width: 200px;',
    box('display: block; height: 10px;') +
      ib('width: 50px; height: 20px;').repeat(2) +
      box('display: block; height: 10px;'),
  ),
  align_top: root(
    'display: block; width: 200px;',
    ib('width: 50px; height: 20px; vertical-align: top;') +
      ib('width: 50px; height: 40px; vertical-align: top;'),
  ),
  align_middle: root(
    'display: block; width: 200px;',
    ib('width: 50px; height: 20px; vertical-align: middle;') +
      ib('width: 50px; height: 40px; vertical-align: middle;'),
  ),
  text_align_center: root(
    'display: block; width: 200px; text-align: center;',
    ib('width: 50px; height: 20px;').repeat(2),
  ),
  text_align_right: root(
    'display: block; width: 200px; text-align: right;',
    ib('width: 50px; height: 20px;'),
  ),
  in_flex_column: root('width: 200px;', ib('width: 50px; height: 20px;').repeat(2)),
  in_flex_row: root(
    'flex-direction: row; width: 200px;',
    ib('width: 50px; height: 20px;').repeat(2),
  ),
  nested: root(
    'display: block; width: 200px;',
    ib('', ib('width: 30px; height: 20px;').repeat(2)) + ib('width: 40px; height: 10px;'),
  ),
};

const abs = (style: string) => box(`position: absolute; ${style}`);
const sized = 'width: 30px; height: 20px;';

const POSITION: Record<string, string> = {
  insets_relative_parent: root(
    'width: 200px; height: 100px;',
    abs(`${sized} top: 10px; left: 20px;`),
  ),
  bottom_right: root('width: 200px; height: 100px;', abs(`${sized} bottom: 10px; right: 20px;`)),
  fills_between_insets: root(
    'width: 200px; height: 100px;',
    abs('top: 10px; bottom: 20px; left: 5px; right: 15px;'),
  ),
  percent_insets: root(
    'width: 200px; height: 100px; padding: 10px;',
    abs(`${sized} top: 50%; left: 25%;`),
  ),
  percent_size: root(
    'width: 200px; height: 100px; padding: 10px;',
    abs('width: 50%; height: 50%; top: 0; left: 0;'),
  ),
  static_parent: root(
    'width: 200px; height: 100px;',
    box(
      'position: static; width: 100px; height: 50px; margin: 10px;',
      abs(`${sized} bottom: 0; right: 0;`),
    ),
  ),
  static_parent_left_right: root(
    'width: 200px; height: 100px;',
    box(
      'position: static; width: 100px; height: 50px; margin: 10px;',
      abs('left: 0; right: 0; top: 0; height: 10px;'),
    ),
  ),
  static_chain: root(
    'width: 200px; height: 100px;',
    box(
      'position: static; margin: 10px;',
      box('position: static; margin: 10px; height: 20px;', abs('inset: 0;')),
    ),
  ),
  no_insets_after_sibling: root('width: 200px; height: 100px;', box('height: 30px;') + abs(sized)),
  no_insets_centred_parent: root(
    'width: 200px; height: 100px; align-items: center; justify-content: center;',
    abs(sized),
  ),
  no_insets_row: root(
    'flex-direction: row; width: 200px; height: 100px;',
    box('width: 40px;') + abs(sized),
  ),
  no_insets_padded: root(
    'width: 200px; height: 100px; padding: 10px; border-width: 5px;',
    abs(sized),
  ),
  inset_zero_margin_auto: root(
    'width: 200px; height: 100px;',
    abs(`${sized} inset: 0; margin: auto;`),
  ),
  border_and_padding_origin: root(
    'width: 200px; height: 100px; padding: 10px; border-width: 5px;',
    abs(`${sized} top: 0; left: 0;`),
  ),
  relative_offsets: root(
    'width: 200px; height: 100px;',
    box(`${sized} position: relative; top: 10px; left: 20px;`) + box(sized),
  ),
  relative_percent_offsets: root(
    'width: 200px; height: 100px;',
    box(`${sized} position: relative; top: 10%; left: 10%;`),
  ),
  relative_bottom_right: root(
    'width: 200px; height: 100px;',
    box(`${sized} position: relative; bottom: 10px; right: 20px;`),
  ),
  static_ignores_insets: root(
    'width: 200px; height: 100px;',
    box(`${sized} position: static; top: 10px; left: 20px;`),
  ),
  absolute_in_scroller: root(
    'width: 200px; height: 100px; overflow: scroll;',
    box('height: 300px;') + abs(`${sized} bottom: 0; right: 0;`),
  ),
  absolute_shrinks_to_content: root(
    'width: 200px; height: 100px;',
    abs('top: 0; left: 0;').replace('></div>', `>${box('width: 70px; height: 20px;')}</div>`),
  ),
};

const grid = (style: string, inside: string) => root(`display: grid; ${style}`, inside);
const at = (style: string) => box(style);
const PAGE =
  "grid-template-areas: 'head head' 'side main'; grid-template-columns: 50px 100px; grid-template-rows: 20px 40px;";
const LINES =
  'grid-template-columns: [full-start] 20px [content-start] 60px [content-end] 20px [full-end]; grid-auto-rows: 10px;';

/** Named areas and named lines, which Taffy's fixtures place nothing by. */
const GRID_NAMES: Record<string, string> = {
  areas: grid(PAGE, at('grid-area: main;') + at('grid-area: head;') + at('grid-area: side;')),
  areas_empty_cells: grid(
    "grid-template-areas: 'a .' '. b'; grid-template-columns: 30px 40px; grid-template-rows: 10px 20px;",
    at('grid-area: b;') + at('grid-area: a;'),
  ),
  areas_auto_placed_around: grid(PAGE, at('grid-area: side;') + at('') + at('') + at('')),
  areas_beyond_template: grid(
    "grid-template-areas: 'a b c' 'a d d'; grid-template-columns: 30px; grid-auto-columns: 20px; grid-auto-rows: 15px;",
    at('grid-area: d;') + at('grid-area: a;') + at('grid-area: c;'),
  ),
  areas_as_lines: grid(
    PAGE,
    at('grid-column: head-start / head-end; grid-row: side-start;') +
      at('grid-row-start: head-start; grid-column-start: main-start;'),
  ),
  areas_content_sized: grid(
    "grid-template-areas: 'a b'; width: 200px; grid-template-columns: auto 1fr;",
    at('grid-area: b; height: 10px;') + at('grid-area: a; width: 40px; height: 30px;'),
  ),
  lines: grid(
    LINES,
    at('grid-column: content-start / content-end;') +
      at('grid-column: full-start / full-end;') +
      at('grid-column-start: content-end;'),
  ),
  lines_as_area: grid(LINES, at('grid-column: content;') + at('grid-column: full;')),
  lines_span: grid(
    LINES,
    at('grid-column: content-start / span 2;') + at('grid-column-end: full-end;'),
  ),
  lines_repeated: grid(
    'grid-template-columns: repeat(3, [col] 40px) [end]; grid-auto-rows: 10px;',
    at('grid-column: col 2 / col 3;') +
      at('grid-column: col 3 / end;') +
      at('grid-column-start: col;'),
  ),
  lines_unknown: grid(
    'grid-template-columns: 30px 40px; grid-auto-columns: 15px; grid-auto-rows: 10px;',
    at('grid-column: nowhere;') + at('grid-column: 1 / nowhere;') + at(''),
  ),
  lines_many_names: grid(
    'grid-template-columns: [a b] 30px [c] 40px [d e]; grid-template-rows: [top] 10px [middle] 20px [bottom];',
    at('grid-column: b / c; grid-row: middle / bottom;') + at('grid-column: c / e; grid-row: top;'),
  ),
};

/** Generated fixtures, by `suite/name`, as the markup of their root box. */
export const GENERATED: Readonly<Record<string, string>> = Object.fromEntries([
  ...Object.entries(INLINE_BLOCK).map(([name, markup]) => [`inline-block/${name}`, markup]),
  ...Object.entries(POSITION).map(([name, markup]) => [`position/${name}`, markup]),
  ...Object.entries(GRID_NAMES).map(([name, markup]) => [`grid-names/${name}`, markup]),
]);
