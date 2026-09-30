import { Directive, ElementRef, type OnChanges, inject, input } from '@angular/core';
import { HostEngine, type HostNode } from '@ng-native/fabric';

/**
 * The view a component makes to hold its children, styled by the app through
 * `contentContainerClass`: `<scroll-view>`'s content view, and the view `<keyboard-avoiding-view>`
 * moves.
 *
 * The view is written in the component's template, so on its own it matches only that
 * component's rules and the global sheet. The class is the app's, so while there is one the view
 * is matched against the rules of the template the component is written in, and against its own
 * again once the class is gone. Not before: a type selector in the app's styles would otherwise
 * reach a view that nobody there wrote.
 */
@Directive({
  selector: '[contentContainerOf]',
  host: { '[class]': 'classes()' },
})
export class ContentContainer implements OnChanges {
  /** The component the view belongs to, whose template the app wrote it in. */
  readonly owner = input.required<HostNode>({ alias: 'contentContainerOf' });
  /** The app's classes for the view. */
  readonly classes = input<string>(undefined, { alias: 'contentContainerClass' });

  private readonly node = inject(ElementRef).nativeElement as HostNode;
  private readonly engine: HostEngine = this.node.host ?? inject(HostEngine);

  ngOnChanges(): void {
    this.engine.adoptScope(this.node, this.classes() ? this.owner() : null);
  }
}
