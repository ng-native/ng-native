---
__default__: patch
---

On the GTK desktop host on Linux, `<native-button>`, `<switch>`, `<activity-indicator>`, `<segmented-control>`, `<search-field>` and `<date-time-picker>` draw as GTK and libadwaita controls at GTK's own sizes, with the events and commands they have on macOS: `AdwSpinner` and `AdwToggleGroup` where libadwaita 1.6 and 1.7 provide them, `GtkSpinner` and linked toggle buttons before that, and a date picker that picks a day in a `GtkCalendar` (its time modes show the time without picking it yet).
