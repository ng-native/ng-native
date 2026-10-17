import { Component, inject, signal } from '@angular/core';
import { NativeScript, NsView, nsView } from '@ng-native/nativescript';

export const label = nsView<{ title: string }, { id: string; text: string }>({
  create: (props) => ({ id: 'label', text: props.title }),
  update: (view, props) => {
    view.text = props.title;
  },
});

export const badge = nsView<{ title: string }, { id: string; text: string }>({
  create: (props) => ({ id: 'badge', text: props.title }),
});

@Component({
  selector: 'ns-view-fixture',
  imports: [NsView],
  template: `<ns-view testID="native" [view]="spec()" [props]="{ title: title() }" />`,
})
export class NsViewFixture {
  readonly native = inject(NativeScript);
  readonly spec = signal(label);
  readonly title = signal('Hello');
  readonly model = this.native.call({ ios: () => 'iPhone', android: () => 'Pixel' });
}

@Component({
  selector: 'ns-view-only-fixture',
  imports: [NsView],
  template: `<ns-view [view]="view" [props]="{ title: 'Hello' }" />`,
})
export class NsViewOnlyFixture {
  readonly native = inject(NativeScript);
  readonly view = label;
}
