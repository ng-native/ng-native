---
__default__: patch
---

A component can name itself in interaction reports, or be left out of them, with an `interactionName` attribute on its host.

`host: { interactionName: 'Checkout card' }`, or `interactionName="Checkout card"` where the component is used, makes `InteractionEvent.component` report that name instead of the selector, including for a page with no selector. An empty `interactionName` leaves the component out, so its controls report the component around it, or no `component`. The attribute is read only when an interaction is reported and is never committed to the native view.
