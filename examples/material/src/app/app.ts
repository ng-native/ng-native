import { Component } from '@angular/core';
import { SafeAreaProvider } from '@ng-native/components';
import { NativeStackOutlet } from '@ng-native/router';

/** The shell: a native stack, themed by Material's tokens, which `.material` carries. */
@Component({
  selector: 'app-root',
  imports: [NativeStackOutlet, SafeAreaProvider],
  template: `
    <safe-area-provider>
      <native-stack-outlet />
    </safe-area-provider>
  `,
  host: { class: 'material', '[style]': 'fill' },
})
export class App {
  protected readonly fill = { flex: 1 };
}
