---
__default__: patch
---

On Android, a `HardwareBack.handle()` handler a screen subscribes from its constructor is asked only while that screen is in front, so a screen pushed or presented over it gets the back press instead of the handler of the screen underneath.

Before, the screen below had subscribed after the stack it is in, so React Native asked its handler first: a form that claimed the button to confirm leaving kept a screen it had opened from going back. A handler subscribed outside an injection context, or where no screen is provided, such as an app's root component or a service, is asked as before, whatever is showing.
