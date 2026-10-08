---
'__default__': patch
---

A custom property set on a box, or a class such as `dark` added to one, restyles what is under it without finding each element's rules again.

Finding the rules that match an element is most of what styling it costs, and both changes found them again for every element under the box, as a first render does. An element now keeps the rules it matched, and is styled from them when the change above it cannot have altered them: a custom property, which no selector reads, and a class that rules name only for the element that has it or for particular elements beneath, which alone are matched again. A theme token changed on a screen of 1,800 elements took 24 ms and takes 15; a `dark` class on its root took 41 ms and takes 27 where the classes are composed ones. Nothing an app sees changes but the time.
