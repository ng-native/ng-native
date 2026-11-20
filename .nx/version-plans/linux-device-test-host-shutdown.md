---
__default__: patch
---

In-app tests on Linux end a host that ignores SIGTERM together with the processes it started, instead of only the shell that runs it, and the project's root, not the folder Vitest was started in, is where the desktop CLI is asked for the host. When the host runs in a container, `host.docker.internal` resolves on Docker Engine on Linux as well as on Docker Desktop.
