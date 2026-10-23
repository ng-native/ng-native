---
title: Native views
summary: A UIView or Android View built in TypeScript, sized by the template like any other element.
---

# Native views

`<ns-view>` shows a native view an app builds in TypeScript: a UIView on iOS, an `android.view.View`
on Android. The template places and sizes the element
like any other view; the UIView fills it.

```ts
import { Component, signal } from '@angular/core';
import { Pressable, Text } from '@ng-native/components';
import { NsView, nsView } from '@ng-native/nativescript';

const badge = nsView<{ title: string }, UILabel>({
  create(props) {
    'worklet';
    const label = UILabel.new();
    label.text = props.title;
    label.textAlignment = NSTextAlignment.Center;
    label.backgroundColor = UIColor.systemYellowColor;
    return label;
  },
  update(label, props) {
    'worklet';
    label.text = props.title;
  },
});

@Component({
  selector: 'app-counter',
  imports: [NsView, Pressable, Text],
  template: `
    <ns-view class="h-12" [view]="badge" [props]="{ title: 'Count ' + count() }" />
    <pressable (press)="count.set(count() + 1)"><text>Add one</text></pressable>
  `,
})
export class Counter {
  protected readonly badge = badge;
  protected readonly count = signal(0);
}
```

`nsView()` declares the view: `create` builds it from the props, and `update` brings it up to date
each time they change. Both are worklets, and run on the main thread, where UIKit can be touched;
see [Calling native APIs](/packages/nativescript/calling-apis#on-the-ui-thread-runonui) for what a
worklet can read. Declare the view at the top of a file, as `badge` is above: an object there is
left alone by the module's hot reloading, where a function on its own would lose what makes it a
worklet.

## Props

`[props]` is passed to `create`, then to `update` whenever the object changes. It is copied to the
main thread, so it holds plain data: numbers, strings, booleans, and objects and arrays of them. A
function in it arrives as one the worklet cannot call.

An object literal in the template, as above, is a new object only when a value in it changes, so
`update` runs when the title does and not on every change detection.

`update` is optional. Without it a view shows what `create` built, whatever the props become.

## Views and their lifetime

A different `[view]` builds a new view in place of the one shown, and the old one is released. So is
the view of an element that goes, from an `@if` or an `@for`. The view is held on the main thread
from `create` until then.

UIKit holds a delegate or a control's target weakly, so one made in `create` is released as soon as
`create` returns unless something holds it. Hold it on the view, as a property of its own: a native
object takes JavaScript properties beside its native ones, and keeps them as long as it is held.

```ts
const field = nsView<{ placeholder: string }, UITextField>({
  create(props) {
    'worklet';
    const ReturnKey = NSObject.extend(
      { textFieldShouldReturn: (view: UITextField) => view.resignFirstResponder() },
      { protocols: [UITextFieldDelegate] },
    );
    const view = UITextField.new() as UITextField & { heldDelegate?: NSObject };
    view.placeholder = props.placeholder;
    const delegate = ReturnKey.new();
    view.delegate = delegate;
    view.heldDelegate = delegate;
    return view;
  },
});
```

`heldDelegate` is a name of the app's own; any name the class does not use works. It is not in
the class's types, hence the cast.

`create` returns a UIView. What it throws is reported to Angular's `ErrorHandler`, and so is a
value that is not a UIView, `null` included; either way the element is left empty, and a view it
showed before a new `[view]` is let go.

Each view is a separate `create` on the main thread: a hundred `<ns-view>` elements build theirs in
about a tenth of a second on the iOS simulator.

## Sizing

The element is laid out by its styles, as a `<view>` is, and the UIView is sized to it. The view's
own size is not measured: a `UILabel` does not make its element as tall as its text. Give the
element a size, or a size from its container, as `class="h-12"` does above.

A view with a fixed size of its own, such as a `UISwitch`, stays that size, at the top left of the
element.

## Touches

The UIView takes the touches that land on it, as a view inside any UIKit app does. A drag that
starts on a view with gestures of its own, a map or a SceneKit view with `allowsCameraControl`,
pans that view rather than scrolling a `<scroll-view>` it is in.

## Children

`<ns-view>` shows its UIView and nothing else: elements written inside it are not rendered. Put
them beside it, or over it with `position: absolute`.

## On Android

On Android `create` returns an `android.view.View`, made with `androidContext()`, the current
Activity, and both functions run on the main thread:

```ts
import { androidContext, nsView } from '@ng-native/nativescript';

const badge = nsView<{ title: string }, android.widget.TextView>({
  create(props) {
    'worklet';
    const label = new android.widget.TextView(androidContext() as android.content.Context);
    label.setText(props.title);
    return label;
  },
  update(label, props) {
    'worklet';
    label.setText(props.title);
  },
});
```

The view fills the element, as on iOS. A spec is for one platform: a template that shows a native
view on both picks one spec or the other, by `NativeScript`'s `platform`.

## Behind it

`@nativescript/react-native` ships a Fabric view, `NativeScriptUIView`, that shows the UIView whose
pointer it is given. `<ns-view>` commits as that view, runs `create` on the main thread, keeps the
view there under the element's id, and binds its pointer to the element. The package's own
`defineUIKitView` does the same for React components, which Angular Native does not render.
