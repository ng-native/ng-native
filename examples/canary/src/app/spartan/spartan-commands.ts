import { Component, signal } from '@angular/core';
import { HlmCommandImports } from './helm/command';

/** Spartan UI's command: a search field over a list it filters as you type. */
@Component({
  selector: 'app-spartan-commands',
  imports: [HlmCommandImports],
  host: { class: 'spartan flex flex-col gap-3' },
  template: `
    <p class="text-muted-foreground text-sm" testID="command-state">Ran: {{ ran() }}</p>
    <hlm-command class="rounded-lg border shadow-md" testID="command">
      <hlm-command-input placeholder="Type a command or search..." />
      <hlm-command-list testID="command-list">
        <div *hlmCommandEmptyState hlmCommandEmpty>No results found.</div>
        <hlm-command-group>
          <hlm-command-group-label>Suggestions</hlm-command-group-label>
          <button hlm-command-item value="Calendar" (selected)="ran.set('calendar')">
            Calendar
          </button>
          <button hlm-command-item value="Calculator" (selected)="ran.set('calculator')">
            Calculator
          </button>
          <button hlm-command-item value="Emoji" disabled (selected)="ran.set('emoji')">
            Emoji
          </button>
        </hlm-command-group>
        <hlm-command-separator />
        <hlm-command-group>
          <hlm-command-group-label>Settings</hlm-command-group-label>
          <button hlm-command-item value="Profile" (selected)="ran.set('profile')">
            Profile
            <hlm-command-shortcut>⌘P</hlm-command-shortcut>
          </button>
        </hlm-command-group>
      </hlm-command-list>
    </hlm-command>
  `,
})
export class SpartanCommands {
  protected readonly ran = signal('nothing');
}
