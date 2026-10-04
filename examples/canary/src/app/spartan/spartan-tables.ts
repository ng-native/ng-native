import { Component } from '@angular/core';
import { HlmKbdImports } from './helm/kbd';
import { HlmTableImports } from './helm/table';

interface Invoice {
  readonly id: string;
  readonly status: string;
  readonly amount: string;
}

/** Spartan UI's table, written as an HTML table, and its keyboard keys. */
@Component({
  selector: 'app-spartan-tables',
  imports: [HlmKbdImports, HlmTableImports],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <div hlmTableContainer>
      <table hlmTable testID="table">
        <caption hlmCaption>
          A list of recent invoices.
        </caption>
        <thead hlmTHead>
          <tr hlmTr testID="table-head-row">
            <th hlmTh>Invoice</th>
            <th hlmTh>Status</th>
            <th hlmTh class="text-right">Amount</th>
          </tr>
        </thead>
        <tbody hlmTBody>
          @for (invoice of invoices; track invoice.id) {
            <tr hlmTr [attr.testID]="'row-' + invoice.id">
              <td hlmTd class="font-medium">{{ invoice.id }}</td>
              <td hlmTd>{{ invoice.status }}</td>
              <td hlmTd class="text-right">{{ invoice.amount }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="flex items-center gap-2">
      <kbd hlmKbdGroup testID="kbd-group">
        <kbd hlmKbd testID="kbd">⌘</kbd>
        <kbd hlmKbd>K</kbd>
      </kbd>
      <kbd hlmKbd>Ctrl</kbd>
    </div>
  `,
})
export class SpartanTables {
  protected readonly invoices: Invoice[] = [
    { id: 'INV001', status: 'Paid', amount: '$250.00' },
    { id: 'INV002', status: 'Pending', amount: '$150.00' },
    { id: 'INV003', status: 'Unpaid', amount: '$350.00' },
  ];
}
