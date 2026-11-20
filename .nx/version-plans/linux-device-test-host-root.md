---
__default__: patch
---

In-app tests on Linux ask the desktop CLI for the host from the project's root, not the folder Vitest was started in. When the host runs in a container, `host.docker.internal` resolves on Docker Engine on Linux as well as on Docker Desktop.
