import { Service, signal } from '@angular/core';

/** Whether the admin page's guard lets anyone in. The settings page turns it on and off. */
@Service()
export class AdminAccess {
  readonly granted = signal(false);
}
