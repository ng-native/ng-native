/**
 * A menu written as a template of `<menu-item>`s, as `[contextMenu]` and
 * `<native-header-item [menu]>` take one: the items are made outside the app's tree, where they
 * draw nothing and only register with the menu model given to them.
 */
import {
  ApplicationRef,
  Injector,
  RendererFactory2,
  type EmbeddedViewRef,
  type TemplateRef,
} from '@angular/core';
import { MENU_MODEL, menuModelInTreeOrder, type MenuModel } from './menu-model.ts';

export interface MenuTemplate {
  /** What the template's items registered, in the order they are written. */
  readonly model: MenuModel;
  /** Destroy the items, which takes them out of the model. */
  destroy(): void;
}

/**
 * Make `template`'s items under `injector`, attached to the app so their bindings stay live. They
 * sit in an element of their own that is never committed, so an item an `@if` shows later has a
 * place among the others to take, rather than going to the end.
 */
export function buildMenuTemplate(
  template: TemplateRef<unknown>,
  injector: Injector,
): MenuTemplate {
  const app = injector.get(ApplicationRef);
  const model = menuModelInTreeOrder();
  const view: EmbeddedViewRef<unknown> = template.createEmbeddedView(
    {},
    Injector.create({ providers: [{ provide: MENU_MODEL, useValue: model }], parent: injector }),
  );
  const renderer = injector.get(RendererFactory2).createRenderer(null, null);
  const holder: unknown = renderer.createElement('view');
  for (const node of view.rootNodes) renderer.appendChild(holder, node);
  app.attachView(view);
  view.detectChanges();
  return {
    model,
    destroy: () => {
      app.detachView(view);
      view.destroy();
    },
  };
}
