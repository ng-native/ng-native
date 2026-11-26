---
__default__: patch
---

On iOS, Android and the desktop, a plural, select or other ICU message in a template renders again on Angular 22.3, where each one threw `Action failed because the element is clobbered`, and a page presented over the tab bar keeps the `errorComponent` Angular 22.3 added to a route.

Angular 22.3 checks that each node it walks while reading an ICU case links back to its parent and previous sibling. The stand-in document `@ng-native/platform` parses those cases in now has both links. A presented page's copy of its route keeps `errorComponent`, as it keeps `component`. A route above the page drops it, as it drops `component`. The repository's own Angular pins move to 22.3.0, which new apps already install.
