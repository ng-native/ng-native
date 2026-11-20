---
__default__: patch
---

On the GTK desktop host on Linux, a `<date-time-picker>` in `time` mode picks a time as an hour and a minute in spin buttons, within its minimum and maximum, where it showed the time and picked nothing before; the hour runs 1 to 12 beside an AM and PM button when the locale writes a 12-hour clock, and a `datetime` picker shows the calendar and the time together. `countdown` picks hours and minutes on a 24-hour clock, with no AM and PM button.
