---
__default__: patch
---

`getByPlaceholderText` and its `query`, `find` and `All` forms find a `<native-search-bar>` by its placeholder again, as they did before 0.4.0 limited the query to text fields. A wrapper component's host carrying a `placeholder` attribute is still not matched.
