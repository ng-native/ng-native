import { Component, inject } from '@angular/core';
import { MenuBar, MenuGroup, MenuItem, SafeAreaProvider } from '@ng-native/components';
import { nativePlatform } from '@ng-native/fabric';
import { NativeNavigation, NativeStackOutlet } from '@ng-native/router';

/**
 * The shell: a native stack, with the tab bar as its first screen. On macOS the tabs are the
 * window's sidebar, and the menu bar's File menu makes a note; iPad and hardware keyboards get
 * its shortcut too.
 */
@Component({
  selector: 'app-root',
  imports: [MenuBar, MenuGroup, MenuItem, NativeStackOutlet, SafeAreaProvider],
  template: `
    <menu-bar>
      <menu-group label="File" menuRole="file">
        <menu-item label="New Note" shortcut="mod+n" (select)="newNote()" />
      </menu-group>
    </menu-bar>
    <safe-area-provider>
      <native-stack-outlet />
    </safe-area-provider>
  `,
  // The class the Tailwind preset's ios: and android: variants match against.
  host: { '[class]': 'platformClass', '[style]': 'fill' },
})
export class App {
  protected readonly platformClass = `platform-${nativePlatform()}`;
  protected readonly fill = { flex: 1 };
  private readonly navigation = inject(NativeNavigation);

  protected newNote(): void {
    void this.navigation.push(['/note/new']);
  }
}
