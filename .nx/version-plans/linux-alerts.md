---
__default__: patch
---

On the GTK desktop host on Linux, `Alert.alert`, `Alert.prompt` and `Dialogs`' `tell`, `confirm`, `choose` and `ask` show a real alert. Before, they answered at once with the cancel button and showed nothing. The alert is an `AdwAlertDialog` in the active window on libadwaita 1.5 and later. On libadwaita 1.4, or with no window, it is an `AdwMessageDialog`, a modal window of its own. Its buttons follow GNOME's order: Cancel first and on Escape, the first button last and on Return unless it is destructive. A destructive button is drawn red. A prompt's text, password or login and password fields are in the alert, and an alert closed with no button answers as Cancel.
