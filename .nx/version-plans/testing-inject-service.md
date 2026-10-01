---
__default__: minor
---

`@ng-native/testing` adds `injectService(Service, { providers })`, which tests a service on its own, with no component to render, in a fresh app's root injector that `cleanup()` destroys.

There is no TestBed, and `Injector.create()` finds no `@Service()` or `providedIn: 'root'` class, because the injector it makes has no root scope. `injectService` mounts an empty component with `mount()`, as `render()` does, so the service and the root services it injects resolve as they do in an app.
