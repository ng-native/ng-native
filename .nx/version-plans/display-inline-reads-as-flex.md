---
__default__: patch
---

`display: inline` and `display: inline-block` are now read as `flex`, as `block` and `inline-flex` already were, rather than dropped with a build warning.

Every native view sits in a flex container, and a browser lays out a flex container's inline and inline-block children as blocks. So Tailwind's `inline` and `inline-block`, and Bootstrap's `.d-inline`, now show an element hidden by an earlier rule, as `md:inline` after `hidden` does on the web. Tailwind generates `.inline` whenever the word appears in a file it scans, such as a README, so an app no longer gets a warning about a class nobody wrote. `grid`, `inline-grid` and the table values are still dropped with a warning.
