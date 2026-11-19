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
// cookie file keeps between launches as NSHTTPCookieStorage does. A proxy comes from libcurl's
// environment variables (`http_proxy`, `https_proxy`, `ALL_PROXY` and the rest) when any is set,
// else from the desktop's settings (desktopProxies), each request's for its url; `NO_PROXY` applies
// to either. A `file:` url that is not a regular file is refused. TLS is the system's
// OpenSSL, verifying against the certificates findCaCertificates() locates.
#pragma once

#include "ngn/network.h"

#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace ngn {

struct CurlOptions {
  // Where the cookie store is kept between launches, in libcurl's (Netscape's) cookie file format,
  // readable by the user alone. Its lasting cookies are loaded at the start, and it is written again
  // whenever a request or connection has finished and the store differs from the file: a session
  // cookie, or one that has expired, is never written. Empty keeps the store in memory.
  std::string cookieFile;
  // The desktop's proxies for a url, best first, as GProxyResolver and the proxy portal answer
  // (`direct://` for none). Asked on the network thread as a request or WebSocket starts, once per
  // origin every 30 seconds at most, unless a libcurl proxy variable is set, which wins. Unset, or answering nothing usable: libcurl's own
  // choice, from the environment.
  std::function<std::vector<std::string>(const std::string &url)> desktopProxies;
  // The app's name and version, which lead the User-Agent (curlUserAgent).
  std::string appName;
  std::string appVersion;
};

// The User-Agent a request sends unless it sets its own: `<name>/<version> ng-native libcurl/<v>`,
// as CFNetwork's on macOS leads with the app's bundle name and version. The name is percent-encoded
// where an HTTP token cannot hold it; without a version it stands alone, and without a name only
// `ng-native libcurl/<v>` is sent.
std::string curlUserAgent(const std::string &appName, const std::string &appVersion);

// The proxy libcurl takes (CURLOPT_PROXY) for desktopProxies' answer: the first it can use, with
// GNOME's `socks://` as SOCKS 5, and `direct://` as "" (none, whatever the environment says).
// Nothing when no entry is usable.
std::optional<std::string> curlProxyFor(const std::vector<std::string> &proxies);

// Whether any proxy variable libcurl reads is set, not empty: `http_proxy`, `https_proxy` or
// `HTTPS_PROXY`, `all_proxy` or `ALL_PROXY` (`NO_PROXY` only excludes hosts, so it is not one).
bool proxyEnvironmentSet(const std::function<std::optional<std::string>(const char *name)> &env);

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
