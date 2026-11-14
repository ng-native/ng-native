import {
  ApplicationRef,
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  computed,
  forwardRef,
  effect,
  inject,
  input,
  signal,
  type EmbeddedViewRef,
  type TemplateRef,
} from '@angular/core';
import { MENU_MODEL, OS, serializeMenu, type MenuModel } from '@ng-native/device';
import { HostEngine, type HostNode } from '@ng-native/fabric';
import { menuModelInTreeOrder } from './menu.ts';

/**
 * Whether an element has a context menu, for `<pressable>`: on iOS and Android a long press opens
 * the menu, so `(longPress)` does not also fire.
 */
export const CONTEXT_MENU = new InjectionToken<{ has(): boolean }>('angular-native.contextMenu');

/**
 * A context menu on an element: `[contextMenu]="menu"`, with `<ng-template #menu>` holding
 * `<menu-item>`s. A right-click opens it on every OS with a pointer, and a long press on iOS
 * (UIContextMenuInteraction) and Android (a PopupMenu at the press point).
 *
 * The host contract: the view takes a `contextMenu` prop, the menu as `serializeMenu` makes it
 * (null to take it away), and sends `topContextMenuSelect` with the chosen item's `id`.
 */
@Directive({
  selector: '[contextMenu]',
  providers: [{ provide: CONTEXT_MENU, useExisting: forwardRef(() => ContextMenu) }],
})
export class ContextMenu {
  readonly contextMenu = input<TemplateRef<unknown> | null>();

  private readonly node = inject(ElementRef).nativeElement as HostNode;
  private readonly engine = inject(HostEngine);
  private readonly injector = inject(Injector);
  private readonly app = inject(ApplicationRef);
  private readonly os = inject(OS);
  private view: EmbeddedViewRef<unknown> | null = null;
  private readonly model = signal<MenuModel | null>(null);
  private readonly menu = computed(() => serializeMenu(this.model()?.entries() ?? [], this.os));

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

  /** Whether the element has a menu now. */
  has(): boolean {
    return this.menu().entries.length > 0;
  }

  /**
   * Make the template's items, outside the tree: they draw nothing, and only register with the
   * menu model this provides them. Attached to the app so their bindings stay live.
   */
  private build(template: TemplateRef<unknown> | null): void {
    if (this.view) {
      this.app.detachView(this.view);
      this.view.destroy();
      this.view = null;
      this.model.set(null);
    }
    if (!template) return;
    const model = menuModelInTreeOrder();
    const injector = Injector.create({
      providers: [{ provide: MENU_MODEL, useValue: model }],
      parent: this.injector,
    });
    this.model.set(model);
    this.view = template.createEmbeddedView({}, injector);
    this.app.attachView(this.view);
    this.view.detectChanges();
  }
}
