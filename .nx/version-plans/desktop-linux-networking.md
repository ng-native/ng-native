---
__default__: patch
---

The GTK desktop host on Linux has networking: `fetch`, `XMLHttpRequest` and `WebSocket` work there over libcurl.

The host build fetches a static libcurl 8.23.0, checks it against its SHA-256 and links it in, with the system's OpenSSL 3, nghttp2 and zlib. Requests follow redirects, time out after their `timeout` with no byte in either direction (300 seconds by default; a response header line counts only once it is whole, so one sent slowly enough can time out while its bytes arrive), decode gzip and deflate bodies, report upload progress, share cookies when they send credentials, and read `file:` and `data:` urls, as on macOS; a `file:` url that is not a regular file fails. Unlike macOS, cookies last only as long as the app runs, and a proxy is taken only from libcurl's environment variables (`http_proxy`, `https_proxy`, `ALL_PROXY`, `NO_PROXY` and the rest), not the desktop's settings. WebSockets send and receive text and binary messages, ping and answer pings, and close with a code and reason; a text message that is not UTF-8 fails the connection; a close the app starts that the server never answers with its own close frame ends with code 1006, and one whose server picks a subprotocol that was not offered fails. TLS certificates come from `SSL_CERT_FILE` or `SSL_CERT_DIR` when set, else the bundle or directory the distribution keeps.
