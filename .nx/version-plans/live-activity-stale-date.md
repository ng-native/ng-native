---
'__default__': patch
---

`liveActivity()` takes a `staleDate` option, which answers when what the activity shows is out of date: iOS then draws the layout with `environment().isStale` true. A Live Activity's layout reads what it is drawn in from an `environment` input, as a home-screen widget's does.
