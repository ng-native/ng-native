---
__default__: patch
---

On iPadOS a relaunch now shows each window in the scene iPadOS restores for it, where the restored scene showed the main window and opening a hidden window left blank windows behind.

The scene host (`NgNativeWindows` in `@ng-native/components`) keeps the key of the window each scene session had in the app's user defaults, under `dev.ngnative.windowKeys`. `AppWindows` opening a key takes the scene kept for it: the restored scene, or a hidden one, where the window shows once the user opens it. A scene that connects after the app has launched goes to the windows even when it was made for the app's scene delegate, so React Native no longer starts a second time in it. The scene the app launched in waits five seconds for its own window; where the app does not open that key, a window waiting for its hidden scene shows there instead, or the scene closes.
