import { Component, signal } from '@angular/core';
import { TuiButton } from '@taiga-ui/core/components/button';
import { TuiDataList } from '@taiga-ui/core/components/data-list';
import { TuiDropdown } from '@taiga-ui/core/portals/dropdown';
import { TuiBadge } from '@taiga-ui/kit/components/badge';

interface Plan {
  readonly name: string;
  readonly price: string;
  readonly appearance: string;
}

const PLANS: readonly Plan[] = [
  { name: 'Free', price: 'No charge', appearance: 'neutral' },
  { name: 'Pro', price: '$8 a month', appearance: 'info' },
  { name: 'Team', price: '$20 a month', appearance: 'positive' },
];

/** The plan: a badge naming it, and a dropdown of Taiga's data list to change it. */
@Component({
  selector: 'app-plan-picker',
  imports: [TuiBadge, TuiButton, TuiDataList, TuiDropdown],
  styles: `
    :host {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
    }
    .current {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 8px;
    }
  `,
  template: `
    <div class="current">
      <span>Plan</span>
      <span tuiBadge testID="plan-badge" [appearance]="plan().appearance">{{ plan().name }}</span>
    </div>
    <button
      tuiButton
      appearance="secondary"
      size="s"
      [tuiDropdown]="plans"
      [(tuiDropdownOpen)]="open"
    >
      Change plan
    </button>
    <ng-template #plans>
      <tui-data-list>
        @for (option of options; track option.name) {
          <button tuiOption (click)="choose(option)">{{ option.name }} · {{ option.price }}</button>
        }
      </tui-data-list>
    </ng-template>
  `,
})
export class PlanPicker {
  protected readonly options = PLANS;
  protected readonly plan = signal(PLANS[0]!);
  protected readonly open = signal(false);

  protected choose(plan: Plan): void {
    this.plan.set(plan);
    this.open.set(false);
  }
}
