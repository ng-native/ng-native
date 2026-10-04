import { Component } from '@angular/core';
import { HlmButtonImports } from './helm/button';
import { HlmCardImports } from './helm/card';

/** Spartan UI's card: header with title, description and action, content and footer; and small. */
@Component({
  selector: 'app-spartan-cards',
  imports: [HlmButtonImports, HlmCardImports],
  host: { class: 'spartan flex flex-col gap-4' },
  template: `
    <section hlmCard testID="card">
      <div hlmCardHeader testID="header">
        <h3 hlmCardTitle testID="title">Card title</h3>
        <p hlmCardDescription testID="description">Card description, as the library writes it.</p>
        <div hlmCardAction testID="action">
          <button hlmBtn variant="outline" size="sm">Action</button>
        </div>
      </div>
      <div hlmCardContent testID="content">
        <p>The content of the card, which wraps onto a second line when it is long enough to.</p>
      </div>
      <div hlmCardFooter testID="footer">
        <button hlmBtn testID="save">Save</button>
      </div>
    </section>

    <section hlmCard size="sm" testID="small">
      <div hlmCardHeader>
        <h3 hlmCardTitle testID="small-title">Small card</h3>
        <p hlmCardDescription>With the smaller spacing.</p>
      </div>
      <div hlmCardContent><p>Content.</p></div>
    </section>
  `,
})
export class SpartanCards {}
