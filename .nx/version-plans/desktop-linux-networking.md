---
__default__: patch
---

The GTK desktop host on Linux has networking: `fetch`, `XMLHttpRequest` and `WebSocket` work there over a static libcurl 8.23.0 that the host build fetches, checks against its SHA-256 and links in, with the system's OpenSSL 3, nghttp2 and zlib. Requests follow redirects, time out after their `timeout` with no byte in either direction (300 seconds by default), decode gzip and deflate bodies, report upload progress, share cookies when they send credentials, and read `file:` and `data:` urls, as on macOS. Unlike macOS, cookies last only as long as the app runs, and a proxy is taken only from the `http_proxy`, `https_proxy` and `no_proxy` environment variables. WebSockets send and receive text and binary messages, ping, and close with a code and reason. TLS certificates come from `SSL_CERT_FILE` or `SSL_CERT_DIR` when set, else the bundle or directory the distribution keeps. On Linux, Expo Updates stays off: the host has no update checks yet.
