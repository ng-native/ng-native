#include "ngn/curl-network.h"

#include "ngn/bytes.h"

#include <curl/curl.h>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <deque>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <string_view>
#include <thread>
#include <vector>

namespace ngn {

namespace {

using Clock = std::chrono::steady_clock;
using std::chrono::milliseconds;

// How long the desktop's proxy answer for an origin is used before it is asked again.
constexpr auto kProxyKept = std::chrono::seconds(30);

// NSURLSession's request timeout on macOS (network.mm): a dev server's first bundle can take
// minutes before its first byte.
constexpr milliseconds kDefaultIdle = std::chrono::seconds(300);
// How long a WebSocket's opening handshake may take.
constexpr milliseconds kHandshakeTimeout = std::chrono::seconds(60);
// How long a close this side started waits for the server's close frame.
constexpr milliseconds kCloseWait = std::chrono::seconds(5);
// The longest WebSocket message taken, as macOS's maximumMessageSize.
constexpr size_t kMaxMessage = 64 * 1024 * 1024;
// The redirects followed before giving up, as browsers count them.
constexpr long kMaxRedirects = 20;
// The reads one WebSocket gets in one pass of the thread (up to 4 MB), so a server that keeps
// sending cannot hold up every other request and connection.
constexpr int kReceiveBudget = 64;

void initCurl() {
  static std::once_flag once;
  std::call_once(once, [] { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

// NSURLSession's English descriptions of the matching NSURLError, which is what JavaScript gets on
// macOS. libcurl is built without its own messages (cmake/curl.cmake).
std::string errorText(CURLcode code) {
  switch (code) {
    case CURLE_OPERATION_TIMEDOUT:
      return "The request timed out.";
    case CURLE_COULDNT_RESOLVE_HOST:
    case CURLE_COULDNT_RESOLVE_PROXY:
      return "A server with the specified hostname could not be found.";
    case CURLE_COULDNT_CONNECT:
      return "Could not connect to the server.";
    case CURLE_SSL_CONNECT_ERROR:
    case CURLE_PEER_FAILED_VERIFICATION:
    case CURLE_SSL_CERTPROBLEM:
    case CURLE_SSL_CIPHER:
    case CURLE_SSL_CACERT_BADFILE:
    case CURLE_SSL_PINNEDPUBKEYNOTMATCH:
    case CURLE_SSL_INVALIDCERTSTATUS:
      return "An SSL error has occurred and a secure connection to the server cannot be made.";
    case CURLE_TOO_MANY_REDIRECTS:
      return "too many HTTP redirects";
    case CURLE_UNSUPPORTED_PROTOCOL:
    case CURLE_URL_MALFORMAT:
      return "unsupported URL";
    case CURLE_GOT_NOTHING:
    case CURLE_RECV_ERROR:
    case CURLE_SEND_ERROR:
    case CURLE_PARTIAL_FILE:
    case CURLE_HTTP2:
    case CURLE_HTTP2_STREAM:
      return "The network connection was lost.";
    case CURLE_BAD_CONTENT_ENCODING:
      return "cannot decode raw data";
    case CURLE_FILE_COULDNT_READ_FILE:
      return "The requested URL was not found on this server.";
    case CURLE_HTTP_RETURNED_ERROR:
    case CURLE_WEIRD_SERVER_REPLY:
      return "There was a bad response from the server.";
    default:
      return "A network error occurred (libcurl error " + std::to_string(static_cast<int>(code)) + ").";
  }
}

// Whether a cookie line in libcurl's (Netscape's) format is one to keep past this launch: one with
// an expiry still to come. A session cookie's expiry is 0. `#HttpOnly_` lines are cookies; other `#`
// lines and blank ones are not.
bool lastingCookie(std::string_view line, time_t now) {
  if (line.empty() || (line[0] == '#' && line.rfind("#HttpOnly_", 0) != 0)) {
    return false;
  }
  size_t at = 0;
  for (int field = 0; field < 4; ++field) {
    at = line.find('\t', at);
    if (at == std::string_view::npos) {
      return false;
    }
    ++at;
  }
  auto end = line.find('\t', at);
  if (end == std::string_view::npos) {
    return false;
  }
  long long expires = 0;
  for (char c : line.substr(at, end - at)) {
    if (c < '0' || c > '9') {
      return false;
    }
    expires = expires * 10 + (c - '0');
  }
  return expires > now;
}

bool startsWithNoCase(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() &&
      std::equal(prefix.begin(), prefix.end(), text.begin(), [](char a, char b) { return std::tolower(a) == std::tolower(b); });
}

bool sameName(std::string_view a, std::string_view b) {
  return a.size() == b.size() && startsWithNoCase(a, b);
}

std::string_view trimmed(std::string_view s) {
  while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) {
    s.remove_prefix(1);
  }
  while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\r' || s.back() == '\n')) {
    s.remove_suffix(1);
  }
  return s;
}

std::string upper(std::string s) {
  for (auto &c : s) {
    c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  }
  return s;
}

// A url curl can parse, whatever its scheme: macOS's NSURL refuses only what is not a url.
bool parses(const std::string &url) {
  CURLU *u = curl_url();
  bool ok = curl_url_set(u, CURLUPART_URL, url.c_str(), CURLU_NON_SUPPORT_SCHEME) == CURLUE_OK;
  curl_url_cleanup(u);
  return ok;
}

// A WebSocket url with an http or https scheme as ws or wss, which NSURLSession's WebSocket task
// takes and curl's does not. React Native's HMR client opens Metro's /hot by the bundle's http url.
std::string webSocketUrl(const std::string &url) {
  if (startsWithNoCase(url, "http://")) {
    return "ws://" + url.substr(7);
  }
  if (startsWithNoCase(url, "https://")) {
    return "wss://" + url.substr(8);
  }
  return url;
}

// Whether a `file:` url names a regular file. Anything else (a FIFO with no writer, a device)
// can block the open that curl makes on the thread every request shares, so it is refused first.
bool regularFile(const std::string &url) {
  CURLU *u = curl_url();
  char *path = nullptr;
  bool ok = curl_url_set(u, CURLUPART_URL, url.c_str(), 0) == CURLUE_OK &&
      curl_url_get(u, CURLUPART_PATH, &path, CURLU_URLDECODE) == CURLUE_OK;
  struct stat st {};
  ok = ok && stat(path, &st) == 0 && S_ISREG(st.st_mode);
  curl_free(path);
  curl_url_cleanup(u);
  return ok;
}

// At most `limit` bytes of UTF-8 `text`, cut before a character rather than inside one.
std::string utf8Prefix(const std::string &text, size_t limit) {
  if (text.size() <= limit) {
    return text;
  }
  size_t n = limit;
  while (n > 0 && (static_cast<unsigned char>(text[n]) & 0xC0) == 0x80) {
    --n;
  }
  return text.substr(0, n);
}

// Whether `text` is well-formed UTF-8: no overlong forms, surrogates or code points past U+10FFFF.
bool validUtf8(std::string_view text) {
  size_t i = 0;
  while (i < text.size()) {
    auto c = static_cast<unsigned char>(text[i]);
    size_t extra;
    unsigned char low = 0x80, high = 0xBF;
    if (c < 0x80) {
      ++i;
      continue;
    } else if (c >= 0xC2 && c <= 0xDF) {
      extra = 1;
    } else if (c >= 0xE0 && c <= 0xEF) {
      extra = 2;
      low = c == 0xE0 ? 0xA0 : 0x80;
      high = c == 0xED ? 0x9F : 0xBF;
    } else if (c >= 0xF0 && c <= 0xF4) {
      extra = 3;
      low = c == 0xF0 ? 0x90 : 0x80;
      high = c == 0xF4 ? 0x8F : 0xBF;
    } else {
      return false;
    }
    if (text.size() - i <= extra) {
      return false;
    }
    for (size_t k = 1; k <= extra; ++k) {
      auto b = static_cast<unsigned char>(text[i + k]);
      unsigned char lo = k == 1 ? low : 0x80, hi = k == 1 ? high : 0xBF;
      if (b < lo || b > hi) {
        return false;
      }
    }
    i += extra + 1;
  }
  return true;
}

// A `data:` url's bytes: `data:[<type>][;base64],<data>`, its data percent-decoded. A fragment
// (from the first `#`) is not part of it; `%23` is a `#` in the data.
std::optional<std::string> dataUriBytes(const std::string &url) {
  const std::string uri = url.substr(0, url.find('#'));
  auto comma = uri.find(',');
  if (comma == std::string::npos) {
    return std::nullopt;
  }
  std::string_view meta(uri.data() + 5, comma - 5);
  bool base64 = meta.size() >= 7 && sameName(meta.substr(meta.size() - 7), ";base64");
  std::string data;
  for (size_t i = comma + 1; i < uri.size(); ++i) {
    char c = uri[i];
    if (c == '%' && i + 2 < uri.size() && std::isxdigit(static_cast<unsigned char>(uri[i + 1])) &&
        std::isxdigit(static_cast<unsigned char>(uri[i + 2]))) {
      data += static_cast<char>(std::stoi(uri.substr(i + 1, 2), nullptr, 16));
      i += 2;
    } else {
      data += c;
    }
  }
  if (!base64) {
    return data;
  }
  std::erase_if(data, [](char c) { return std::isspace(static_cast<unsigned char>(c)); });
  return base64Decode(data);
}

struct HttpState {
  // Held while a callback runs and while cancel marks the request done, so none runs after cancel
  // returns. Recursive, since a callback may cancel its own request.
  std::recursive_mutex mutex;
  HttpCallbacks callbacks;
  bool done{false};
};

struct SocketState {
  std::recursive_mutex mutex;
  WebSocketCallbacks callbacks;
  bool finished{false};
};

class Engine;

// One request on the thread.
struct Transfer {
  ~Transfer() {
    curl_slist_free_all(headers);
    curl_easy_cleanup(easy);
  }

  void touch() {
    lastActivity = Clock::now();
  }

  // The response JavaScript sees: the last one, after any 1xx and followed redirects.
  void respond(uint16_t status) {
    responded = true;
    if (!http) {
      // A `file:` url answers with no headers, as a non-HTTP response does on macOS.
      headerLines.clear();
    }
    HttpResponse response{.status = status, .headers = std::move(headerLines)};
    char *url = nullptr;
    curl_easy_getinfo(easy, CURLINFO_EFFECTIVE_URL, &url);
    response.url = url ? url : "";
    std::lock_guard lock(state->mutex);
    if (!state->done && state->callbacks.onResponse) {
      state->callbacks.onResponse(response);
    }
  }

  CURL *easy{curl_easy_init()};
  curl_slist *headers{nullptr};
  std::shared_ptr<HttpState> state;
  // The body, which curl reads in place.
  std::string body;
  bool http{true};
  Headers headerLines;
  bool responded{false};
  curl_off_t sentReported{0};
  milliseconds idle{kDefaultIdle};
  Clock::time_point lastActivity{Clock::now()};
};

// One WebSocket on the thread.
struct Socket {
  enum class Phase { Connecting, Open };
  struct Frame {
    unsigned flags;
    std::string bytes;
    size_t offset{0};
    // Handed to curl at least once, after which curl takes nothing else until it is all sent.
    bool started{false};
  };

  ~Socket() {
    curl_slist_free_all(headers);
    curl_easy_cleanup(easy);
  }

  CURL *easy{curl_easy_init()};
  curl_slist *headers{nullptr};
  std::shared_ptr<SocketState> state;
  Phase phase{Phase::Connecting};
  Clock::time_point started{Clock::now()};
  // The subprotocols offered, and the one the server chose.
  std::vector<std::string> offered;
  std::string protocol;
  curl_socket_t fd{CURL_SOCKET_BAD};
  // What is still to send, oldest first; held until the socket opens.
  std::deque<Frame> outgoing;
  // A message whose fragments are still arriving, and a close frame's payload.
  std::string message;
  unsigned messageFlags{0};
  std::string closePayload;
  // A ping's payload while it arrives, which its pong echoes.
  std::string pingPayload;
  // This side's close frame, queued and then sent, and when to stop waiting for the closing
  // handshake to finish.
  bool closeQueued{false};
  bool closeSent{false};
  Clock::time_point closeDeadline;
  // The server's close frame, once it has come.
  bool peerClosed{false};
  int peerCode{1005};
  std::string peerReason;
};

class Engine {
 public:
  explicit Engine(CurlOptions options) : options_(std::move(options)) {
    initCurl();
    multi_ = curl_multi_init();
    share_ = curl_share_init();
    // Every handle lives on the thread, so the shared cookie store needs no lock.
    curl_share_setopt(share_, CURLSHOPT_SHARE, CURL_LOCK_DATA_COOKIE);
    ca_ = findCaCertificates();
    useDesktopProxies_ = options_.desktopProxies && !proxyEnvironmentSet([](const char *name) -> std::optional<std::string> {
      const char *value = getenv(name);
      return value ? std::optional<std::string>(value) : std::nullopt;
    });
    if (!options_.cookieFile.empty()) {
      // A handle of its own reads and fills the shared store.
      cookies_ = curl_easy_init();
      useCookies(cookies_);
      loadCookies();
    }
  }

  ~Engine() {
    for (auto &[_, t] : transfers_) {
      curl_multi_remove_handle(multi_, t->easy);
    }
    for (auto &[_, s] : sockets_) {
      curl_multi_remove_handle(multi_, s->easy);
    }
    transfers_.clear();
    sockets_.clear();
    if (cookies_ != nullptr) {
      saveCookies();
      curl_easy_cleanup(cookies_);
    }
    curl_multi_cleanup(multi_);
    curl_share_cleanup(share_);
  }

  // Runs `command` on the thread. Any thread; dropped once the engine stops.
  void post(std::function<void()> command) {
    std::lock_guard lock(mutex_);
    if (stopping_) {
      return;
    }
    queue_.push_back(std::move(command));
    curl_multi_wakeup(multi_);
  }

  void stop() {
    std::lock_guard lock(mutex_);
    stopping_ = true;
    queue_.clear();
    curl_multi_wakeup(multi_);
  }

  uint64_t nextId() {
    return ++ids_;
  }

  void run() {
    for (;;) {
      std::vector<std::function<void()>> commands;
      {
        std::lock_guard lock(mutex_);
        if (stopping_) {
          return;
        }
        commands.swap(queue_);
      }
      for (auto &command : commands) {
        command();
      }
      int running = 0;
      curl_multi_perform(multi_, &running);
      finished();
      serviceSockets();
      expire();
      std::vector<curl_waitfd> fds;
      for (auto &[_, s] : sockets_) {
        if (s->phase == Socket::Phase::Open && s->fd != CURL_SOCKET_BAD) {
          // Nothing is read past the server's close frame, so its socket is not waited on to read.
          short events = s->peerClosed ? 0 : CURL_WAIT_POLLIN;
          if (!s->outgoing.empty()) {
            events |= CURL_WAIT_POLLOUT;
          }
          if (events != 0) {
            fds.push_back({.fd = s->fd, .events = events, .revents = 0});
          }
        }
      }
      curl_multi_poll(multi_, fds.data(), static_cast<unsigned>(fds.size()), nextWaitMs(), nullptr);
    }
  }

  // --- HTTP ---------------------------------------------------------------------------------

  void start(uint64_t id, HttpRequest request, std::shared_ptr<HttpState> state) {
    {
      std::lock_guard lock(state->mutex);
      if (state->done) {
        return;
      }
    }
    if (startsWithNoCase(request.url, "data:")) {
      answerDataUri(request.url, *state);
      return;
    }
    if (startsWithNoCase(request.url, "file:") && !regularFile(request.url)) {
      std::lock_guard lock(state->mutex);
      if (!state->done) {
        state->done = true;
        if (state->callbacks.onComplete) {
          state->callbacks.onComplete(errorText(CURLE_FILE_COULDNT_READ_FILE), false);
        }
      }
      return;
    }
    auto t = std::make_unique<Transfer>();
    t->state = std::move(state);
    t->http = startsWithNoCase(request.url, "http:") || startsWithNoCase(request.url, "https:");
    if (request.timeoutMs > 0) {
      t->idle = milliseconds(request.timeoutMs);
    }
    CURL *e = t->easy;
    common(e);
    if (t->http) {
      useProxy(e, request.url);
    }
    curl_easy_setopt(e, CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(e, CURLOPT_PRIVATE, t.get());
    curl_easy_setopt(e, CURLOPT_PROTOCOLS_STR, "http,https,file");
    curl_easy_setopt(e, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
    curl_easy_setopt(e, CURLOPT_FOLLOWLOCATION, CURLFOLLOW_OBEYCODE);
    curl_easy_setopt(e, CURLOPT_MAXREDIRS, kMaxRedirects);
    // Every encoding curl can decode, decoded, as NSURLSession does.
    curl_easy_setopt(e, CURLOPT_ACCEPT_ENCODING, "");
    curl_easy_setopt(e, CURLOPT_HEADERFUNCTION, &Engine::onHeader);
    curl_easy_setopt(e, CURLOPT_HEADERDATA, t.get());
    curl_easy_setopt(e, CURLOPT_WRITEFUNCTION, &Engine::onWrite);
    curl_easy_setopt(e, CURLOPT_WRITEDATA, t.get());
    curl_easy_setopt(e, CURLOPT_NOPROGRESS, 0L);
    curl_easy_setopt(e, CURLOPT_XFERINFOFUNCTION, &Engine::onProgress);
    curl_easy_setopt(e, CURLOPT_XFERINFODATA, t.get());

    std::string method = upper(request.method.empty() ? "GET" : request.method);
    bool hasBody = false;
    if (method == "GET") {
      curl_easy_setopt(e, CURLOPT_HTTPGET, 1L);
    } else if (method == "HEAD") {
      curl_easy_setopt(e, CURLOPT_NOBODY, 1L);
    } else {
      if (method != "POST") {
        curl_easy_setopt(e, CURLOPT_CUSTOMREQUEST, request.method.c_str());
        // curl treats this method's body as a POST's, and would make it a GET on a 301 or 302 too.
        // Only POST changes there, as in browsers.
        curl_easy_setopt(e, CURLOPT_POSTREDIR, static_cast<long>(CURL_REDIR_POST_301 | CURL_REDIR_POST_302));
      }
      // A body goes as curl's POST does, under the method named, and POST, PUT and PATCH send an
      // empty one with its length. OBEYCODE above turns a POST into a GET on a 301, 302 or 303,
      // and any method into a GET on a 303, as NSURLSession does.
      if (!request.body.empty() || method == "POST" || method == "PUT" || method == "PATCH") {
        t->body = std::move(request.body);
        curl_easy_setopt(e, CURLOPT_POST, 1L);
        curl_easy_setopt(e, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(t->body.size()));
        curl_easy_setopt(e, CURLOPT_POSTFIELDS, t->body.data());
        hasBody = true;
      }
    }
    bool contentType = false;
    bool expect = false;
    for (const auto &[name, value] : request.headers) {
      contentType = contentType || sameName(name, "content-type");
      expect = expect || sameName(name, "expect");
      // "Name;" is curl's spelling of a header with an empty value; "Name:" would remove it.
      t->headers = curl_slist_append(t->headers, (value.empty() ? name + ";" : name + ": " + value).c_str());
    }
    // curl's own Content-Type for a body (a url-encoded form) and its 100-continue wait for a
    // large one, which NSURLSession sends neither of.
    if (hasBody && !contentType) {
      t->headers = curl_slist_append(t->headers, "Content-Type:");
    }
    if (!expect) {
      t->headers = curl_slist_append(t->headers, "Expect:");
    }
    curl_easy_setopt(e, CURLOPT_HTTPHEADER, t->headers);
    if (request.withCredentials) {
      useCookies(e);
    }
    t->touch();
    curl_multi_add_handle(multi_, e);
    transfers_[id] = std::move(t);
  }

  void drop(uint64_t id) {
    auto it = transfers_.find(id);
    if (it != transfers_.end()) {
      curl_multi_remove_handle(multi_, it->second->easy);
      transfers_.erase(it);
    }
  }

  void clearCookies(const std::function<void(bool)> &done) {
    CURL *e = curl_easy_init();
    useCookies(e);
    curl_slist *cookies = nullptr;
    curl_easy_getinfo(e, CURLINFO_COOKIELIST, &cookies);
    bool any = cookies != nullptr;
    curl_slist_free_all(cookies);
    curl_easy_setopt(e, CURLOPT_COOKIELIST, "ALL");
    curl_easy_cleanup(e);
    // Cleared for the next launch too.
    saveCookies();
    if (done) {
      done(any);
    }
  }

  // --- WebSocket ----------------------------------------------------------------------------

  void connect(uint64_t id, const std::string &url, const std::vector<std::string> &protocols, const Headers &headers,
               std::shared_ptr<SocketState> state) {
    {
      std::lock_guard lock(state->mutex);
      if (state->finished) {
        return;
      }
    }
    auto s = std::make_unique<Socket>();
    s->state = std::move(state);
    s->offered = protocols;
    CURL *e = s->easy;
    common(e);
    // The desktop names proxies for http and https; a WebSocket starts as one of those.
    auto ws = webSocketUrl(url);
    useProxy(e, startsWithNoCase(ws, "wss:") ? "https:" + ws.substr(4) : "http:" + ws.substr(3));
    curl_easy_setopt(e, CURLOPT_URL, ws.c_str());
    curl_easy_setopt(e, CURLOPT_PROTOCOLS_STR, "ws,wss");
    // The handshake through the multi handle, then frames by curl_ws_send and curl_ws_recv.
    curl_easy_setopt(e, CURLOPT_CONNECT_ONLY, 2L);
    // A ping is answered through the outgoing queue: curl's own pong waits for a send or a read
    // that finds more, which an idle connection never makes.
    curl_easy_setopt(e, CURLOPT_WS_OPTIONS, static_cast<long>(CURLWS_NOAUTOPONG));
    curl_easy_setopt(e, CURLOPT_HEADERFUNCTION, &Engine::onSocketHeader);
    curl_easy_setopt(e, CURLOPT_HEADERDATA, s.get());
    // A refused upgrade's body, which would otherwise go to stdout.
    curl_easy_setopt(e, CURLOPT_WRITEFUNCTION, &Engine::discard);
    for (const auto &[name, value] : headers) {
      s->headers = curl_slist_append(s->headers, (value.empty() ? name + ";" : name + ": " + value).c_str());
    }
    if (!protocols.empty()) {
      std::string joined;
      for (const auto &p : protocols) {
        joined += (joined.empty() ? "" : ", ") + p;
      }
      s->headers = curl_slist_append(s->headers, ("Sec-WebSocket-Protocol: " + joined).c_str());
    }
    curl_easy_setopt(e, CURLOPT_HTTPHEADER, s->headers);
    // The handshake carries the cookie store's cookies, as NSURLSession's does.
    useCookies(e);
    curl_multi_add_handle(multi_, e);
    sockets_[id] = std::move(s);
  }

  void send(uint64_t id, unsigned flags, std::string bytes) {
    auto it = sockets_.find(id);
    if (it == sockets_.end() || it->second->closeQueued || it->second->peerClosed) {
      return;
    }
    it->second->outgoing.push_back({.flags = flags, .bytes = std::move(bytes)});
  }

  void close(uint64_t id, int code, const std::string &reason) {
    auto it = sockets_.find(id);
    if (it == sockets_.end()) {
      return;
    }
    Socket &s = *it->second;
    if (s.phase == Socket::Phase::Connecting) {
      // As NSURLSession cancels a task that has not opened.
      fail(id, "cancelled");
      return;
    }
    if (s.closeQueued || s.peerClosed) {
      return;
    }
    // A close frame's payload is at most 125 bytes: the code's two and 123 of reason, which stays
    // valid UTF-8.
    queueClose(s, closePayload(code, utf8Prefix(reason, 123)));
  }

 private:
  void common(CURL *e) {
    curl_easy_setopt(e, CURLOPT_NOSIGNAL, 1L);
    // A proxy's answer to CONNECT is not the response.
    curl_easy_setopt(e, CURLOPT_SUPPRESS_CONNECT_HEADERS, 1L);
    // NSURLSession always names itself, and some servers refuse a request that does not. A
    // User-Agent header of the request's own replaces it.
    curl_easy_setopt(e, CURLOPT_USERAGENT, "ng-native libcurl/" LIBCURL_VERSION);
    if (!ca_.file.empty()) {
      curl_easy_setopt(e, CURLOPT_CAINFO, ca_.file.c_str());
    }
    if (!ca_.directory.empty()) {
      curl_easy_setopt(e, CURLOPT_CAPATH, ca_.directory.c_str());
    }
  }

  // The desktop's proxy for `url`, unless the environment names one (libcurl reads it itself). Asked
  // once per origin (scheme, host and port) for kProxyKept, so a changed setting arrives within it;
  // a redirect keeps the first url's proxy.
  void useProxy(CURL *e, const std::string &url) {
    if (!useDesktopProxies_) {
      return;
    }
    auto now = Clock::now();
    std::erase_if(proxies_, [now](const auto &entry) { return now - entry.second.asked >= kProxyKept; });
    auto origin = url.substr(0, url.find('/', url.find("://") + 3));
    auto it = proxies_.find(origin);
    if (it == proxies_.end()) {
      it = proxies_.emplace(origin, KeptProxy{now, curlProxyFor(options_.desktopProxies(url))}).first;
    }
    if (it->second.proxy) {
      curl_easy_setopt(e, CURLOPT_PROXY, it->second.proxy->c_str());
    }
  }

  void useCookies(CURL *e) {
    curl_easy_setopt(e, CURLOPT_SHARE, share_);
    // An empty name turns the cookie engine on without reading a file.
    curl_easy_setopt(e, CURLOPT_COOKIEFILE, "");
  }

  // The cookie file's lasting cookies into the store.
  void loadCookies() {
    std::ifstream in(options_.cookieFile);
    std::string line;
    time_t now = time(nullptr);
    while (std::getline(in, line)) {
      if (lastingCookie(line, now)) {
        curl_easy_setopt(cookies_, CURLOPT_COOKIELIST, line.c_str());
        saved_ += line + "\n";
      }
    }
  }

  // The store's lasting cookies into the cookie file, when they differ from what it holds: written
  // beside it, readable by the user alone, then moved over it, so a crash leaves one or the other.
  void saveCookies() {
    if (cookies_ == nullptr) {
      return;
    }
    curl_slist *list = nullptr;
    curl_easy_getinfo(cookies_, CURLINFO_COOKIELIST, &list);
    std::string text;
    time_t now = time(nullptr);
    for (auto *item = list; item != nullptr; item = item->next) {
      if (lastingCookie(item->data, now)) {
        text += std::string(item->data) + "\n";
      }
    }
    curl_slist_free_all(list);
    if (text == saved_) {
      return;
    }
    std::error_code error;
    std::filesystem::path file(options_.cookieFile);
    std::filesystem::create_directories(file.parent_path(), error);
    auto partial = options_.cookieFile + ".partial";
    int fd = open(partial.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) {
      return;
    }
    std::string out = "# Netscape HTTP Cookie File\n" + text;
    bool written = ::write(fd, out.data(), out.size()) == static_cast<ssize_t>(out.size());
    written = ::close(fd) == 0 && written;
    if (written && rename(partial.c_str(), options_.cookieFile.c_str()) == 0) {
      saved_ = std::move(text);
    } else {
      unlink(partial.c_str());
    }
  }

  // Sends a close frame after what is already queued, and waits kCloseWait for the handshake.
  static void queueClose(Socket &s, std::string payload) {
    s.closeQueued = true;
    s.closeDeadline = Clock::now() + kCloseWait;
    s.outgoing.push_back({.flags = CURLWS_CLOSE, .bytes = std::move(payload)});
  }

  static std::string closePayload(int code, const std::string &reason) {
    std::string out;
    out += static_cast<char>((code >> 8) & 0xff);
    out += static_cast<char>(code & 0xff);
    return out + reason;
  }

  void answerDataUri(const std::string &uri, HttpState &state) {
    auto bytes = dataUriBytes(uri);
    std::lock_guard lock(state.mutex);
    if (state.done) {
      return;
    }
    if (!bytes) {
      state.done = true;
      if (state.callbacks.onComplete) {
        state.callbacks.onComplete("Invalid URL: " + uri, false);
      }
      return;
    }
    if (state.callbacks.onResponse) {
      state.callbacks.onResponse({.status = 200, .url = uri});
    }
    if (!state.done && !bytes->empty() && state.callbacks.onData) {
      auto size = static_cast<int64_t>(bytes->size());
      state.callbacks.onData(std::move(*bytes), size);
    }
    if (!state.done) {
      state.done = true;
      if (state.callbacks.onComplete) {
        state.callbacks.onComplete("", false);
      }
    }
  }

  static size_t onHeader(char *buffer, size_t size, size_t count, void *data) {
    auto *t = static_cast<Transfer *>(data);
    size_t length = size * count;
    t->touch();
    if (t->responded) {
      // Trailers after the body.
      return length;
    }
    std::string_view line(buffer, length);
    if (line.starts_with("HTTP/")) {
      t->headerLines.clear();
      return length;
    }
    if (trimmed(line).empty()) {
      long status = 0;
      curl_easy_getinfo(t->easy, CURLINFO_RESPONSE_CODE, &status);
      bool interim = status >= 100 && status < 200;
      // What curl follows: any 3xx with a Location that is not empty.
      bool redirect = status >= 300 && status < 400 &&
          std::any_of(t->headerLines.begin(), t->headerLines.end(),
                      [](const auto &h) { return sameName(h.first, "location") && !h.second.empty(); });
      if (interim || redirect) {
        // curl goes on to the next response.
        t->headerLines.clear();
      } else if (t->http) {
        t->respond(static_cast<uint16_t>(status));
      }
      return length;
    }
    if ((line.front() == ' ' || line.front() == '\t') && !t->headerLines.empty()) {
      // An obsolete folded line continues the header before it.
      t->headerLines.back().second += " " + std::string(trimmed(line));
      return length;
    }
    auto colon = line.find(':');
    if (colon != std::string_view::npos) {
      t->headerLines.emplace_back(std::string(trimmed(line.substr(0, colon))), std::string(trimmed(line.substr(colon + 1))));
    }
    return length;
  }

  static size_t onWrite(char *buffer, size_t size, size_t count, void *data) {
    auto *t = static_cast<Transfer *>(data);
    size_t length = size * count;
    t->touch();
    if (!t->responded) {
      if (t->http) {
        // A redirect's own body.
        return length;
      }
      t->respond(200);
    }
    curl_off_t expected = -1;
    curl_easy_getinfo(t->easy, CURLINFO_CONTENT_LENGTH_DOWNLOAD_T, &expected);
    std::lock_guard lock(t->state->mutex);
    if (!t->state->done && t->state->callbacks.onData) {
      t->state->callbacks.onData(std::string(buffer, length), expected < 0 ? -1 : static_cast<int64_t>(expected));
    }
    return length;
  }

  static int onProgress(void *data, curl_off_t, curl_off_t, curl_off_t total, curl_off_t sent) {
    auto *t = static_cast<Transfer *>(data);
    if (total > 0 && sent > t->sentReported) {
      t->touch();
      t->sentReported = sent;
      std::lock_guard lock(t->state->mutex);
      if (!t->state->done && t->state->callbacks.onUploadProgress) {
        t->state->callbacks.onUploadProgress(sent, total);
      }
    }
    return 0;
  }

  static size_t discard(char *, size_t size, size_t count, void *) {
    return size * count;
  }

  static size_t onSocketHeader(char *buffer, size_t size, size_t count, void *data) {
    auto *s = static_cast<Socket *>(data);
    std::string_view line(buffer, size * count);
    if (line.starts_with("HTTP/")) {
      s->protocol.clear();
    }
    auto colon = line.find(':');
    if (colon != std::string_view::npos && sameName(trimmed(line.substr(0, colon)), "sec-websocket-protocol")) {
      s->protocol = std::string(trimmed(line.substr(colon + 1)));
    }
    return size * count;
  }

  void finish(Transfer &t, const std::string &error, bool timedOut) {
    std::lock_guard lock(t.state->mutex);
    if (t.state->done) {
      return;
    }
    t.state->done = true;
    if (t.state->callbacks.onComplete) {
      t.state->callbacks.onComplete(error, timedOut);
    }
  }

  void finished() {
    int left = 0;
    bool any = false;
    while (CURLMsg *msg = curl_multi_info_read(multi_, &left)) {
      if (msg->msg != CURLMSG_DONE) {
        continue;
      }
      any = true;
      CURL *e = msg->easy_handle;
      CURLcode result = msg->data.result;
      if (auto t = takeTransfer(e)) {
        curl_multi_remove_handle(multi_, e);
        if (result == CURLE_OK) {
          if (!t->responded) {
            // A `file:` url with an empty file, or a response with no header block end.
            long status = 200;
            if (t->http) {
              curl_easy_getinfo(e, CURLINFO_RESPONSE_CODE, &status);
            }
            t->respond(static_cast<uint16_t>(status));
          }
          finish(*t, "", false);
        } else {
          finish(*t, errorText(result), result == CURLE_OPERATION_TIMEDOUT);
        }
        continue;
      }
      for (auto &[id, s] : sockets_) {
        if (s->easy != e) {
          continue;
        }
        if (result != CURLE_OK) {
          fail(id, errorText(result));
        } else {
          opened(id, *s);
        }
        break;
      }
    }
    // A response or a handshake may have set cookies.
    if (any) {
      saveCookies();
    }
  }

  std::unique_ptr<Transfer> takeTransfer(CURL *e) {
    for (auto it = transfers_.begin(); it != transfers_.end(); ++it) {
      if (it->second->easy == e) {
        auto t = std::move(it->second);
        transfers_.erase(it);
        return t;
      }
    }
    return nullptr;
  }

  void opened(uint64_t id, Socket &s) {
    // The handle stays in the multi handle, whose connection pool keeps the connection
    // curl_ws_recv and curl_ws_send find.
    if (!s.protocol.empty() && std::find(s.offered.begin(), s.offered.end(), s.protocol) == s.offered.end()) {
      // A subprotocol the client never offered fails the connection, as a browser's does.
      fail(id, errorText(CURLE_WEIRD_SERVER_REPLY));
      return;
    }
    curl_easy_getinfo(s.easy, CURLINFO_ACTIVESOCKET, &s.fd);
    s.phase = Socket::Phase::Open;
    std::lock_guard lock(s.state->mutex);
    if (!s.state->finished && s.state->callbacks.onOpen) {
      s.state->callbacks.onOpen(s.protocol);
    }
  }

  // Ends a socket with its error. Nothing follows.
  void fail(uint64_t id, const std::string &message) {
    auto it = sockets_.find(id);
    if (it == sockets_.end()) {
      return;
    }
    auto s = std::move(it->second);
    sockets_.erase(it);
    curl_multi_remove_handle(multi_, s->easy);
    std::lock_guard lock(s->state->mutex);
    if (!s->state->finished) {
      s->state->finished = true;
      if (s->state->callbacks.onError) {
        s->state->callbacks.onError(message);
      }
    }
  }

  void closed(uint64_t id, int code, const std::string &reason) {
    auto it = sockets_.find(id);
    if (it == sockets_.end()) {
      return;
    }
    auto s = std::move(it->second);
    sockets_.erase(it);
    curl_multi_remove_handle(multi_, s->easy);
    std::lock_guard lock(s->state->mutex);
    if (!s->state->finished) {
      s->state->finished = true;
      if (s->state->callbacks.onClose) {
        s->state->callbacks.onClose(code, reason);
      }
    }
  }

  void serviceSockets() {
    more_ = false;
    std::vector<uint64_t> open;
    for (auto &[id, s] : sockets_) {
      if (s->phase == Socket::Phase::Open) {
        open.push_back(id);
      }
    }
    // A callback may close or drop any socket, so each is found again by its id.
    for (uint64_t id : open) {
      if (!flush(id)) {
        continue;
      }
      auto it = sockets_.find(id);
      // Past the server's close frame there is nothing to read.
      if (it != sockets_.end() && !it->second->peerClosed && receive(id)) {
        // curl may hold the rest already, which no poll would wake for.
        more_ = true;
      }
    }
  }

  // Sends what curl takes now; false once the socket is gone.
  bool flush(uint64_t id) {
    auto it = sockets_.find(id);
    if (it == sockets_.end()) {
      return false;
    }
    Socket &s = *it->second;
    while (!s.outgoing.empty()) {
      auto &frame = s.outgoing.front();
      size_t sent = 0;
      CURLcode rc = curl_ws_send(
          s.easy, frame.bytes.data() + frame.offset, frame.bytes.size() - frame.offset, &sent, 0, frame.flags);
      if (rc == CURLE_AGAIN) {
        frame.started = true;
        return true;
      }
      if (rc != CURLE_OK) {
        if (s.peerClosed) {
          // The server closed, and went before this side's answer did.
          closed(id, s.peerCode, s.peerReason);
        } else {
          fail(id, errorText(rc));
        }
        return false;
      }
      frame.started = true;
      frame.offset += sent;
      if (frame.offset < frame.bytes.size()) {
        // The rest of this frame when the socket can take it.
        return true;
      }
      bool close = (frame.flags & CURLWS_CLOSE) != 0;
      s.outgoing.pop_front();
      if (close) {
        s.closeSent = true;
        if (s.peerClosed) {
          closed(id, s.peerCode, s.peerReason);
          return false;
        }
      }
    }
    return true;
  }

  // Reads what has come, up to kReceiveBudget reads; true when the budget ran out first.
  bool receive(uint64_t id) {
    char buffer[64 * 1024];
    for (int reads = 0; reads < kReceiveBudget; ++reads) {
      auto it = sockets_.find(id);
      if (it == sockets_.end()) {
        return false;
      }
      Socket &s = *it->second;
      size_t n = 0;
      const curl_ws_frame *meta = nullptr;
      CURLcode rc = curl_ws_recv(s.easy, buffer, sizeof buffer, &n, &meta);
      if (rc == CURLE_AGAIN) {
        return false;
      }
      if (rc != CURLE_OK || meta == nullptr) {
        if (s.closeQueued) {
          // The server went without its close frame: 1006, an abnormal closure.
          closed(id, 1006, "");
        } else {
          fail(id, rc == CURLE_GOT_NOTHING || rc == CURLE_OK ? "The network connection was lost." : errorText(rc));
        }
        return false;
      }
      if (meta->flags & CURLWS_CLOSE) {
        s.closePayload.append(buffer, n);
        if (meta->bytesleft == 0) {
          serverClosed(id, s);
          return false;
        }
        continue;
      }
      if (meta->flags & CURLWS_PING) {
        s.pingPayload.append(buffer, n);
        if (meta->bytesleft == 0) {
          queuePong(s);
        }
        continue;
      }
      if (meta->flags & CURLWS_PONG) {
        continue;
      }
      if (s.message.empty()) {
        s.messageFlags = meta->flags & (CURLWS_TEXT | CURLWS_BINARY);
      }
      s.message.append(buffer, n);
      if (s.message.size() > kMaxMessage) {
        fail(id, "Message too long");
        return false;
      }
      if (meta->bytesleft == 0 && !(meta->flags & CURLWS_CONT) && !deliver(id, s)) {
        return false;
      }
    }
    return true;
  }

  // The pong to the ping just read, ahead of anything not yet begun and of this side's close.
  static void queuePong(Socket &s) {
    std::string payload;
    payload.swap(s.pingPayload);
    if (s.closeSent) {
      return;
    }
    // One pong waits at most: a later ping's replaces it, as RFC 6455 allows, so a peer that
    // pings without reading cannot grow the queue.
    for (auto &frame : s.outgoing) {
      if (!frame.started && (frame.flags & CURLWS_PONG)) {
        frame.bytes = std::move(payload);
        return;
      }
    }
    auto at = s.outgoing.begin();
    if (at != s.outgoing.end() && at->started) {
      ++at;
    }
    s.outgoing.insert(at, {.flags = CURLWS_PONG, .bytes = std::move(payload)});
  }

  // False once a text message that is not UTF-8 has failed the socket.
  bool deliver(uint64_t id, Socket &s) {
    std::string message;
    message.swap(s.message);
    if ((s.messageFlags & CURLWS_TEXT) && !validUtf8(message)) {
      // As a browser fails the connection on a text message that is not UTF-8.
      fail(id, "Invalid UTF-8 in a text message");
      return false;
    }
    std::lock_guard lock(s.state->mutex);
    if (s.state->finished) {
      return true;
    }
    if (s.messageFlags & CURLWS_TEXT) {
      if (s.state->callbacks.onText) {
        s.state->callbacks.onText(message);
      }
    } else if (s.state->callbacks.onBinary) {
      s.state->callbacks.onBinary(message);
    }
    return true;
  }

  // The server's close frame. The socket closes with its code once this side's close frame has
  // gone, or kCloseWait after.
  void serverClosed(uint64_t id, Socket &s) {
    s.peerClosed = true;
    // 1005: the frame named no code.
    if (s.closePayload.size() >= 2) {
      s.peerCode = (static_cast<unsigned char>(s.closePayload[0]) << 8) | static_cast<unsigned char>(s.closePayload[1]);
      s.peerReason = s.closePayload.substr(2);
    }
    if (s.closeSent) {
      closed(id, s.peerCode, s.peerReason);
      return;
    }
    // Only a frame curl has begun still goes, then this side's close frame: the one queued, else
    // the closing handshake's answer, echoing the server's code.
    std::erase_if(s.outgoing, [](const Socket::Frame &f) { return !f.started && !(f.flags & CURLWS_CLOSE); });
    if (!s.closeQueued) {
      queueClose(s, s.peerCode == 1005 ? "" : closePayload(s.peerCode, ""));
    }
    flush(id);
  }

  void expire() {
    auto now = Clock::now();
    std::vector<uint64_t> late;
    for (auto &[id, t] : transfers_) {
      if (now - t->lastActivity >= t->idle) {
        late.push_back(id);
      }
    }
    for (uint64_t id : late) {
      auto it = transfers_.find(id);
      auto t = std::move(it->second);
      transfers_.erase(it);
      curl_multi_remove_handle(multi_, t->easy);
      finish(*t, errorText(CURLE_OPERATION_TIMEDOUT), true);
    }
    std::vector<uint64_t> unopened, unanswered;
    for (auto &[id, s] : sockets_) {
      if (s->phase == Socket::Phase::Connecting && now - s->started >= kHandshakeTimeout) {
        unopened.push_back(id);
      } else if (s->closeQueued && now >= s->closeDeadline) {
        unanswered.push_back(id);
      }
    }
    for (uint64_t id : unopened) {
      fail(id, errorText(CURLE_OPERATION_TIMEDOUT));
    }
    for (uint64_t id : unanswered) {
      auto &s = *sockets_.at(id);
      if (s.peerClosed) {
        closed(id, s.peerCode, s.peerReason);
      } else {
        // No close frame from the server: 1006, an abnormal closure.
        closed(id, 1006, "");
      }
    }
  }

  int nextWaitMs() const {
    if (more_) {
      return 0;
    }
    auto now = Clock::now();
    auto next = now + std::chrono::seconds(60);
    for (auto &[_, t] : transfers_) {
      next = std::min(next, t->lastActivity + t->idle);
    }
    for (auto &[_, s] : sockets_) {
      if (s->phase == Socket::Phase::Connecting) {
        next = std::min(next, s->started + kHandshakeTimeout);
      } else if (s->closeQueued) {
        next = std::min(next, s->closeDeadline);
      }
    }
    auto wait = std::chrono::duration_cast<milliseconds>(next - now).count();
    return static_cast<int>(std::max<int64_t>(wait + 1, 0));
  }

  CurlOptions options_;
  bool useDesktopProxies_{false};
  struct KeptProxy {
    Clock::time_point asked;
    std::optional<std::string> proxy;
  };
  // The desktop's answers by origin, while they are fresh.
  std::map<std::string, KeptProxy> proxies_;
  CURLM *multi_;
  CURLSH *share_;
  // Reads and fills the store for the cookie file, with what the file last held.
  CURL *cookies_{nullptr};
  std::string saved_;
  CaCertificates ca_;
  std::mutex mutex_;
  std::vector<std::function<void()>> queue_;
  bool stopping_{false};
  // A socket's receive budget ran out with more to read, so the next poll does not wait.
  bool more_{false};
  std::atomic<uint64_t> ids_{0};
  std::map<uint64_t, std::unique_ptr<Transfer>> transfers_;
  std::map<uint64_t, std::unique_ptr<Socket>> sockets_;
};

// Owns the thread. The thread holds the engine until it returns, so a last owner let go on the
// thread itself (a callback dropping a client) leaves it to finish on its own.
class Client {
 public:
  explicit Client(CurlOptions options) : engine_(std::make_shared<Engine>(std::move(options))) {
    thread_ = std::thread([engine = engine_] { engine->run(); });
  }

  ~Client() {
    engine_->stop();
    if (thread_.get_id() == std::this_thread::get_id()) {
      thread_.detach();
    } else {
      thread_.join();
    }
  }

  const std::shared_ptr<Engine> &engine() const {
    return engine_;
  }

 private:
  std::shared_ptr<Engine> engine_;
  std::thread thread_;
};

struct Task final : HttpTask {
  Task(std::weak_ptr<Engine> engine, uint64_t id, std::shared_ptr<HttpState> state)
      : engine(std::move(engine)), id(id), state(std::move(state)) {}
  void cancel() override {
    {
      std::lock_guard lock(state->mutex);
      state->done = true;
    }
    if (auto e = engine.lock()) {
      e->post([raw = e.get(), id = id] { raw->drop(id); });
    }
  }
  std::weak_ptr<Engine> engine;
  uint64_t id;
  std::shared_ptr<HttpState> state;
};

class CurlHttp final : public Http {
 public:
  explicit CurlHttp(std::shared_ptr<Client> client) : client_(std::move(client)) {}

  std::unique_ptr<HttpTask> send(HttpRequest request, HttpCallbacks callbacks) override {
    auto state = std::make_shared<HttpState>();
    state->callbacks = std::move(callbacks);
    if (!startsWithNoCase(request.url, "data:") && !parses(request.url)) {
      if (state->callbacks.onComplete) {
        state->callbacks.onComplete("Invalid URL: " + request.url, false);
      }
      return nullptr;
    }
    auto &engine = client_->engine();
    uint64_t id = engine->nextId();
    engine->post([raw = engine.get(), id, request = std::move(request), state]() mutable {
      raw->start(id, std::move(request), state);
    });
    return std::make_unique<Task>(engine, id, std::move(state));
  }

  void clearCookies(std::function<void(bool cleared)> done) override {
    auto &engine = client_->engine();
    engine->post([raw = engine.get(), done = std::move(done)] { raw->clearCookies(done); });
  }

 private:
  std::shared_ptr<Client> client_;
};

struct Connection final : WebSocketConnection {
  Connection(std::weak_ptr<Engine> engine, uint64_t id) : engine(std::move(engine)), id(id) {}
  ~Connection() override {
    close(1001, "");
  }
  void sendText(const std::string &text) override {
    send(CURLWS_TEXT, text);
  }
  void sendBinary(const std::string &bytes) override {
    send(CURLWS_BINARY, bytes);
  }
  void ping() override {
    send(CURLWS_PING, "");
  }
  void close(int code, const std::string &reason) override {
    if (auto e = engine.lock()) {
      e->post([raw = e.get(), id = id, code, reason] { raw->close(id, code, reason); });
    }
  }
  void send(unsigned flags, std::string bytes) {
    if (auto e = engine.lock()) {
      e->post([raw = e.get(), id = id, flags, bytes = std::move(bytes)]() mutable { raw->send(id, flags, std::move(bytes)); });
    }
  }
  std::weak_ptr<Engine> engine;
  uint64_t id;
};

class CurlWebSockets final : public WebSockets {
 public:
  explicit CurlWebSockets(std::shared_ptr<Client> client) : client_(std::move(client)) {}

  std::unique_ptr<WebSocketConnection> connect(
      const std::string &url,
      const std::vector<std::string> &protocols,
      const Headers &headers,
      WebSocketCallbacks callbacks) override {
    auto state = std::make_shared<SocketState>();
    state->callbacks = std::move(callbacks);
    if (!parses(url)) {
      if (state->callbacks.onError) {
        state->callbacks.onError("Invalid URL: " + url);
      }
      return nullptr;
    }
    auto &engine = client_->engine();
    uint64_t id = engine->nextId();
    engine->post([raw = engine.get(), id, url, protocols, headers, state] { raw->connect(id, url, protocols, headers, state); });
    return std::make_unique<Connection>(engine, id);
  }

 private:
  std::shared_ptr<Client> client_;
};

} // namespace

CurlNetwork makeCurlNetwork(CurlOptions options) {
  auto client = std::make_shared<Client>(std::move(options));
  return {.http = std::make_shared<CurlHttp>(client), .webSockets = std::make_shared<CurlWebSockets>(client)};
}

std::optional<std::string> curlProxyFor(const std::vector<std::string> &proxies) {
  for (const auto &proxy : proxies) {
    if (startsWithNoCase(proxy, "direct://")) {
      return std::string();
    }
    if (startsWithNoCase(proxy, "socks://")) {
      return "socks5://" + proxy.substr(8);
    }
    for (const char *scheme : {"http://", "https://", "socks4://", "socks4a://", "socks5://", "socks5h://"}) {
      if (startsWithNoCase(proxy, scheme)) {
        return proxy;
      }
    }
  }
  return std::nullopt;
}

bool proxyEnvironmentSet(const std::function<std::optional<std::string>(const char *name)> &env) {
  for (const char *name : {"http_proxy", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"}) {
    if (auto value = env(name); value && !value->empty()) {
      return true;
    }
  }
  return false;
}

CaCertificates findCaCertificates(const CaProbe &probe) {
  auto file = probe.env("SSL_CERT_FILE");
  auto directory = probe.env("SSL_CERT_DIR");
  if ((file && !file->empty()) || (directory && !directory->empty())) {
    return {.file = file.value_or(""), .directory = directory.value_or("")};
  }
  for (const char *path : {
           "/etc/ssl/certs/ca-certificates.crt", // Debian, Ubuntu, Arch, Gentoo, the Flatpak runtimes
           "/etc/pki/tls/certs/ca-bundle.crt", // Fedora, RHEL and its rebuilds
           "/etc/ssl/ca-bundle.pem", // openSUSE
           "/etc/pki/tls/cacert.pem", // OpenELEC
           "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem", // CentOS and RHEL 7
           "/etc/ssl/cert.pem", // Alpine, and macOS for a GTK build there
       }) {
    if (probe.isFile(path)) {
      return {.file = path};
    }
  }
  for (const char *path : {"/etc/ssl/certs", "/etc/pki/tls/certs"}) {
    if (probe.isDirectory(path)) {
      return {.directory = path};
    }
  }
  return {};
}

CaCertificates findCaCertificates() {
  return findCaCertificates({
      .env = [](const char *name) -> std::optional<std::string> {
        const char *value = std::getenv(name);
        return value ? std::optional<std::string>(value) : std::nullopt;
      },
      .isFile =
          [](const std::string &path) {
            struct stat st {};
            return stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode) && access(path.c_str(), R_OK) == 0;
          },
      .isDirectory =
          [](const std::string &path) {
            struct stat st {};
            return stat(path.c_str(), &st) == 0 && S_ISDIR(st.st_mode);
          },
  });
}

} // namespace ngn
