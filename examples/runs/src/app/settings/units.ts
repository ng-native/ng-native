import { Service, inject } from '@angular/core';
import { Storage } from '@ng-native/expo/async-storage';
import type { DistanceUnit } from '../tracking/geo.ts';

/** Kilometres or miles, persisted so the choice survives a restart. */
@Service()
export class Units {
  private readonly store = inject(Storage);

  readonly unit = this.store.signal<DistanceUnit>('runs.unit', 'km');

  toggle(): void {
    this.unit.set(this.unit() === 'km' ? 'mi' : 'km');
  }
}
