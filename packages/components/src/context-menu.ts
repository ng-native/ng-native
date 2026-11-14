import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  type TemplateRef,
} from '@angular/core';
import { OS, buildMenuTemplate, serializeMenu, type MenuTemplate } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';

/**
 * A context menu on an element: `[contextMenu]="menu"`, with `<ng-template #menu>` holding
 * `<menu-item>`s. A right-click opens it on macOS. No iOS or Android host draws it yet: the prop is
 * committed and nothing reads it.
 *
 * The host contract: the view takes a `contextMenu` prop, the menu as `serializeMenu` makes it
 * (null to take it away), and sends `topContextMenuSelect` with the chosen item's `id`.
 */
@Directive({ selector: '[contextMenu]' })
export class ContextMenu {
  readonly contextMenu = input<TemplateRef<unknown> | null>();

  private readonly node = inject(ElementRef).nativeElement as HostNode;
  private readonly engine = inject(HostEngine);
  private readonly injector = inject(Injector);
  private readonly os = inject(OS);
  private readonly built = signal<MenuTemplate | null>(null);
  private readonly menu = computed(() =>
    serializeMenu(this.built()?.model.entries() ?? [], this.os),
  );

  constructor() {
    effect(() => this.build(this.contextMenu() ?? null));
    effect(() => {
      const { entries } = this.menu();
      this.engine.setProp(this.node, 'contextMenu', entries.length ? entries : null);
    });
    const stop = this.engine.setEventListener(this.node, 'topContextMenuSelect', (event) => {
      const id = (event as { nativeEvent?: { id?: string } }).nativeEvent?.id;
      if (id !== undefined) this.menu().actions.get(id)?.();
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.build(null);
    });
  }

  /** Make the template's items, which register with the menu this element sends. */
  private build(template: TemplateRef<unknown> | null): void {
    // Read and written outside the effect that calls this, which would otherwise run again.
    untracked(() => {
      this.built()?.destroy();
      this.built.set(template ? buildMenuTemplate(template, this.injector) : null);
    });
  }
}
