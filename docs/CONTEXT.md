# angular-native

Angular applications rendering real native iOS and Android views on React Native's Fabric
renderer, with React never in the render path. This glossary fixes the words the project uses for
its own concepts, so that a name means one thing everywhere.

## Language

**Engine**:
The framework-agnostic retained tree and the code that commits it to Fabric. Knows nothing about
Angular. Lives in `@ng-native/fabric`, which is named for what it talks to.
_Avoid_: renderer, reconciler

**Platform**:
The one Angular-aware layer, which implements `Renderer2` over the engine and bootstraps an
application. The same role `@angular/platform-browser` plays for the DOM.
_Avoid_: adapter, bridge, integration

**Node**:
One entry in the engine's retained tree. May be an element, a text node, or an anchor.
_Avoid_: element (an element is one kind of node), view

**Anchor**:
A node that takes part in sibling ordering but is never sent to Fabric. What Angular's structural
directives insert as a placeholder.
_Avoid_: comment, marker

**Commit**:
One handover of a changed tree to Fabric. At most one happens per change-detection pass.
_Avoid_: flush, render, paint

**Sheet**:
One component's stylesheet, compiled at build time into a sorted rule set and attached to the
component class.
_Avoid_: styles, stylesheet object, CSS

**Global sheet**:
An application-level sheet matched against every node, whatever component created it. The only
rules that deliberately cross a component boundary.
_Avoid_: root styles, app styles

**Host node**:
The node a component is mounted on. Created by the parent's renderer, which is why it belongs to
the parent's sheet rather than the component's own.
_Avoid_: root element, component element

**Condition set**:
The device state that media queries are evaluated against: viewport size, orientation and colour
scheme. Changing it re-resolves styles without any property having changed.
_Avoid_: environment, media state

**Token**:
A CSS custom property. Cascades down the node tree, so a parent may retheme a child component's
internals even though ordinary rules cannot.
_Avoid_: variable, theme value

**Screen**:
One destination on the native stack: a `RNSScreen` the outlet creates per activated route, and
the host element of the page component itself. Screens below the top stay mounted, which is what
keeps a pushed-away page's native state alive.
_Avoid_: page (a page is the component, the screen is what it is mounted on), route, view

**Presentation**:
How a screen enters the stack: pushed, or presented as a sheet, a modal or a full-screen modal.
Native has a vocabulary for this that a URL cannot express, so it travels as navigation state
rather than in the path.
_Avoid_: mode, style, transition

**Navigation intent**:
What a call site meant by a navigation: push, replace, present or reset. A property of the journey
rather than of the destination, which is why the same screen can be pushed from one place and
presented as a sheet from another.
_Avoid_: action, command

**Header**:
The native title bar belonging to a screen, holding its title, the back button and any items the
page puts either side of them. Owned by the screen, not drawn by the page, and it consumes the top
safe-area inset on the page's behalf.
_Avoid_: navbar, toolbar, app bar

**Host primitive**:
A component in `@ng-native/components` whose host element is one native view: `View`,
`Text`, `Image`, `ScrollView` and the rest. Each carries the typed inputs its native view
accepts, plus whatever React Native's JavaScript wrapper adds on top, and must be imported by the
template that uses it. `Primitive` on its own means the behavioural kind below.
_Avoid_: element, tag, primitive

**Primitive**:
A directive composed into a component through `hostDirectives`, carrying one control's behaviour
and none of its looks: what it does to keyboard focus, what it announces to a screen reader, what
state it publishes for a stylesheet to match. `PressBehavior` and `ViewBehavior` are the ones
`@ng-native/components` ships; a component calls `contributeAccessibility` to tell the host
primitive it sits on what role and state to announce. It never adds a view of its own.
_Avoid_: headless component, behaviour, host primitive

**State attribute**:
A `data-*` attribute a primitive writes on its host to say what it is currently doing:
`data-disabled`, `data-invalid` and `data-touched` on `<text-input>`. Not a prop native reads - the
engine keeps hyphenated attributes on the node for selectors alone - so it is how a stylesheet
sees a control's state without the control knowing anything about styling.
_Avoid_: data attribute, flag, marker

**Component**:
A styled control an app builds for itself: one or more primitives composed through
`hostDirectives`, plus the classes that give it a look. The framework ships the behaviour; the
looks belong to the app.
_Avoid_: widget, control, primitive

**Transition**:
An eased change to a property, declared in CSS as `transition:` and driven by the engine when the
cascade recomputes a value. Distinct from an animation: a transition has no timeline of its own,
only a start value it is leaving and an end value it is heading for.
_Avoid_: animation, tween

**Animation**:
A run of `@keyframes` over a duration, declared in CSS as `animation:` and played by the engine.
Unlike a transition it has a timeline of its own and plays from its own frames, so it does not
depend on anything having changed.
_Avoid_: transition, tween

**Responder**:
The single node that currently owns a touch gesture, elected by the capture and bubble passes of
React Native's responder negotiation.
_Avoid_: gesture owner, active element
