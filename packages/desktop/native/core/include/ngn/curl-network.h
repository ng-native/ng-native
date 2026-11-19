// The network interface (network.h) over libcurl, for a backend whose OS has no HTTP and WebSocket
// client to build on: Linux. Built only with NGN_CURL, which the GTK backend turns on.
//
// One thread drives every request and connection through a curl_multi handle, so no call blocks
// its caller, and each request's or connection's callbacks run on that thread, in order. Two
// exceptions: a url that does not parse fails inside send() or connect(), on the caller's thread,
// before either returns (send() then returns no task, connect() no connection); and cancel()
// waits for a callback of that request that is running on the thread to return, so it must not
// be called holding a lock that callback takes. As
// NSURLSession does on macOS: redirects are followed, a request's timeout is the longest it may go
// without a byte in either direction (a header line counts once it is whole, as libcurl hands over
// only whole ones), compressed bodies arrive decoded, `file:` and `data:` urls
// answer 200 with no headers, and requests with credentials share one cookie store, which the
// cookie file keeps between launches as NSHTTPCookieStorage does. A proxy comes only from libcurl's
// environment variables (`http_proxy`, `https_proxy`, `ALL_PROXY`, `NO_PROXY` and the rest), not the
// desktop's settings. A `file:` url that is not a regular file is refused. TLS is the system's
// OpenSSL, verifying against the certificates findCaCertificates() locates.
#pragma once

#include "ngn/network.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>

namespace ngn {

struct CurlOptions {
  // Where the cookie store is kept between launches, in libcurl's (Netscape's) cookie file format,
  // readable by the user alone. Its lasting cookies are loaded at the start, and it is written again
  // whenever a request or connection has finished and the store differs from the file: a session
  // cookie, or one that has expired, is never written. Empty keeps the store in memory.
  std::string cookieFile;
};

// The two clients over one thread, which stops once both are gone.
struct CurlNetwork {
  std::shared_ptr<Http> http;
  std::shared_ptr<WebSockets> webSockets;
};
CurlNetwork makeCurlNetwork(CurlOptions options = {});

// Where TLS finds the trusted certificates: a bundle file, else a directory of hashed ones. Both
// empty leave it to OpenSSL's own default, which is the distribution's when its libcrypto is
// loaded.
struct CaCertificates {
  std::string file;
  std::string directory;
};

// What findCaCertificates reads: an environment variable, and whether a path is a readable file
// or a directory.
struct CaProbe {
  std::function<std::optional<std::string>(const char *name)> env;
  std::function<bool(const std::string &path)> isFile;
  std::function<bool(const std::string &path)> isDirectory;
};

// OpenSSL's SSL_CERT_FILE and SSL_CERT_DIR when either is set, else the first bundle and then the
// first directory each distribution family keeps, in the order Go's crypto/x509 probes them.
CaCertificates findCaCertificates(const CaProbe &probe);
// The same over the real environment and file system.
CaCertificates findCaCertificates();

} // namespace ngn
