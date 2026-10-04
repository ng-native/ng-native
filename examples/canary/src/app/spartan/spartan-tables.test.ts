import { execFileSync } from 'node:child_process';
import { provideWebCompat } from '@ng-native/web-compat';
import { cleanup, render, screen } from '@ng-native/testing';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { SpartanTables } from './spartan-tables.ts';

let tailwind: unknown;
beforeAll(async () => {
  execFileSync(process.execPath, ['metro.config.js'], { stdio: 'pipe' });
  tailwind = (await import('../../../.angular-native/app.tailwind.js')).default;
});
afterEach(cleanup);

const mount = () =>
  render(SpartanTables, {
    globalStyles: tailwind as never,
    providers: [provideWebCompat()],
    conditions: { width: 400, height: 800, colorScheme: 'light' },
  });

test("a table's rows are rows of cells of one width, ruled off below", async () => {
  await mount();
  const head = screen.getByTestId('table-head-row');
  expect(head.props).toMatchObject({ flexDirection: 'row', borderBottomWidth: 1 });
  expect(head.children).toHaveLength(3);
  for (const cell of head.children) {
    expect(cell.props).toMatchObject({ flexGrow: 1, flexBasis: '0%', height: 40 });
  }
  const row = screen.getByTestId('row-INV002');
  expect(row.props).toMatchObject({ flexDirection: 'row' });
  expect(row.children.map((cell) => cell.props['flexGrow'])).toEqual([1, 1, 1]);
});

test('a heading is in the medium weight, and a cell keeps the alignment it is given', async () => {
  await mount();
  expect(screen.getByText('Invoice').props).toMatchObject({ fontWeight: '500' });
  expect(screen.getByText('Amount').props).toMatchObject({ textAlign: 'right' });
  expect(screen.getByText('$150.00').props).toMatchObject({ textAlign: 'right' });
  expect(screen.getByText('A list of recent invoices.').props['color']).toBe('rgb(106, 114, 130)');
});

test('a key is a small muted box, and a group of keys is a row of them', async () => {
  await mount();
  expect(screen.getByTestId('kbd-group').props).toMatchObject({
    flexDirection: 'row',
    columnGap: 4,
  });
  expect(screen.getByTestId('kbd').props).toMatchObject({
    height: 20,
    minWidth: 20,
    backgroundColor: 'rgb(243, 244, 246)',
    justifyContent: 'center',
  });
  expect(screen.getByText('⌘').props).toMatchObject({ fontSize: 12, fontWeight: '500' });
});
