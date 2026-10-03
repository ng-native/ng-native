---
__default__: patch
---

`getByPlaceholderText` and its siblings match text fields only, so a wrapper component with a `placeholder` input of its own no longer makes the query for its one field throw for finding two.
