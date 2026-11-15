#import "network.h"

#import <Foundation/Foundation.h>

#include <map>
#include <mutex>

namespace {

NSString *ns(const std::string &s) {
  NSString *out = [[NSString alloc] initWithBytes:s.data() length:s.size() encoding:NSUTF8StringEncoding];
  return out != nil ? out : @"";
}

std::string str(NSString *s) {
  return s ? std::string(s.UTF8String) : std::string();
}

std::string bytes(NSData *data) {
  __block std::string out;
  out.reserve(data.length);
  [data enumerateByteRangesUsingBlock:^(const void *chunk, NSRange range, BOOL *) {
    out.append(static_cast<const char *>(chunk), range.length);
  }];
  return out;
}

// One request's callbacks. `mutex` is held while a callback runs and while cancel clears them, so
// none runs after cancel returns. Recursive, since a callback may cancel its own request.
struct HttpState {
  std::recursive_mutex mutex;
  ngn::HttpCallbacks callbacks;
  bool done{false};
};

struct SocketState {
  std::recursive_mutex mutex;
  ngn::WebSocketCallbacks callbacks;
  bool opened{false};
  bool finished{false};
};

} // namespace

// The session delegate for both clients. NSURLSession calls it on one serial queue, so each
// task's events arrive in order.
@interface NGNURLSessionDelegate : NSObject <NSURLSessionDataDelegate, NSURLSessionWebSocketDelegate>
- (void)addTask:(NSURLSessionTask *)task state:(std::shared_ptr<HttpState>)state;
- (void)addSocket:(NSURLSessionWebSocketTask *)task state:(std::shared_ptr<SocketState>)state;
@end

@implementation NGNURLSessionDelegate {
  std::mutex _mutex;
  std::map<NSUInteger, std::shared_ptr<HttpState>> _tasks;
  std::map<NSUInteger, std::shared_ptr<SocketState>> _sockets;
}

- (void)addTask:(NSURLSessionTask *)task state:(std::shared_ptr<HttpState>)state {
  std::lock_guard lock(_mutex);
  _tasks[task.taskIdentifier] = std::move(state);
}

- (void)addSocket:(NSURLSessionWebSocketTask *)task state:(std::shared_ptr<SocketState>)state {
  std::lock_guard lock(_mutex);
  _sockets[task.taskIdentifier] = std::move(state);
}

- (std::shared_ptr<HttpState>)task:(NSURLSessionTask *)task remove:(BOOL)remove {
  std::lock_guard lock(_mutex);
  auto it = _tasks.find(task.taskIdentifier);
  if (it == _tasks.end()) {
    return nullptr;
  }
  auto state = it->second;
  if (remove) {
    _tasks.erase(it);
  }
  return state;
}

- (std::shared_ptr<SocketState>)socket:(NSURLSessionTask *)task remove:(BOOL)remove {
  std::lock_guard lock(_mutex);
  auto it = _sockets.find(task.taskIdentifier);
  if (it == _sockets.end()) {
    return nullptr;
  }
  auto state = it->second;
  if (remove) {
    _sockets.erase(it);
  }
  return state;
}

#pragma mark HTTP

- (void)URLSession:(NSURLSession *)session
              dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveResponse:(NSURLResponse *)response
     completionHandler:(void (^)(NSURLSessionResponseDisposition))completionHandler {
  if (auto state = [self task:dataTask remove:NO]) {
    __block ngn::HttpResponse out;
    out.url = str(response.URL.absoluteString);
    if ([response isKindOfClass:NSHTTPURLResponse.class]) {
      auto http = (NSHTTPURLResponse *)response;
      out.status = static_cast<uint16_t>(http.statusCode);
      [http.allHeaderFields enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL *) {
        out.headers.emplace_back(str([key description]), str([value description]));
      }];
    } else {
      // A file or data URL answers like a successful HTTP request, as on iOS.
      out.status = 200;
    }
    std::lock_guard lock(state->mutex);
    if (!state->done && state->callbacks.onResponse) {
      state->callbacks.onResponse(out);
    }
  }
  completionHandler(NSURLSessionResponseAllow);
}

- (void)URLSession:(NSURLSession *)session dataTask:(NSURLSessionDataTask *)dataTask didReceiveData:(NSData *)data {
  if (auto state = [self task:dataTask remove:NO]) {
    int64_t expected = dataTask.response.expectedContentLength;
    std::lock_guard lock(state->mutex);
    if (!state->done && state->callbacks.onData) {
      state->callbacks.onData(bytes(data), expected < 0 ? -1 : expected);
    }
  }
}

- (void)URLSession:(NSURLSession *)session
                        task:(NSURLSessionTask *)task
             didSendBodyData:(int64_t)bytesSent
              totalBytesSent:(int64_t)totalBytesSent
    totalBytesExpectedToSend:(int64_t)totalBytesExpectedToSend {
  if (auto state = [self task:task remove:NO]) {
    std::lock_guard lock(state->mutex);
    if (!state->done && state->callbacks.onUploadProgress) {
      state->callbacks.onUploadProgress(totalBytesSent, totalBytesExpectedToSend);
    }
  }
}

- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task didCompleteWithError:(NSError *)error {
  if (auto socket = [self socket:task remove:YES]) {
    std::lock_guard lock(socket->mutex);
    if (!socket->finished) {
      socket->finished = true;
      if (error != nil && socket->callbacks.onError) {
        socket->callbacks.onError(str(error.localizedDescription));
      } else if (error == nil && socket->callbacks.onClose) {
        auto ws = (NSURLSessionWebSocketTask *)task;
        socket->callbacks.onClose((int)ws.closeCode, ws.closeReason ? bytes(ws.closeReason) : "");
      }
    }
    return;
  }
  auto state = [self task:task remove:YES];
  if (!state) {
    return;
  }
  std::lock_guard lock(state->mutex);
  if (state->done) {
    return;
  }
  state->done = true;
  if (state->callbacks.onComplete) {
    bool timedOut = error != nil && error.code == NSURLErrorTimedOut;
    state->callbacks.onComplete(error != nil ? str(error.localizedDescription) : "", timedOut);
  }
}

#pragma mark WebSocket

- (void)URLSession:(NSURLSession *)session
          webSocketTask:(NSURLSessionWebSocketTask *)task
    didOpenWithProtocol:(NSString *)protocol {
  auto state = [self socket:task remove:NO];
  if (!state) {
    return;
  }
  {
    std::lock_guard lock(state->mutex);
    if (state->finished) {
      return;
    }
    state->opened = true;
    if (state->callbacks.onOpen) {
      state->callbacks.onOpen(str(protocol));
    }
  }
  [self receiveOn:task state:state];
}

- (void)URLSession:(NSURLSession *)session
       webSocketTask:(NSURLSessionWebSocketTask *)task
    didCloseWithCode:(NSURLSessionWebSocketCloseCode)closeCode
              reason:(NSData *)reason {
  auto state = [self socket:task remove:YES];
  if (!state) {
    return;
  }
  std::lock_guard lock(state->mutex);
  if (state->finished) {
    return;
  }
  state->finished = true;
  if (state->callbacks.onClose) {
    state->callbacks.onClose((int)closeCode, reason ? bytes(reason) : "");
  }
}

- (void)receiveOn:(NSURLSessionWebSocketTask *)task state:(std::shared_ptr<SocketState>)state {
  __weak NGNURLSessionDelegate *weakSelf = self;
  [task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message, NSError *error) {
    if (error != nil || message == nil) {
      // The close or failure arrives through the delegate.
      return;
    }
    {
      std::lock_guard lock(state->mutex);
      if (state->finished) {
        return;
      }
      if (message.type == NSURLSessionWebSocketMessageTypeString) {
        if (state->callbacks.onText) {
          state->callbacks.onText(str(message.string));
        }
      } else if (state->callbacks.onBinary) {
        state->callbacks.onBinary(bytes(message.data));
      }
    }
    [weakSelf receiveOn:task state:state];
  }];
}

@end

namespace ngn::appkit {

namespace {

NSURLSession *sharedSession(NGNURLSessionDelegate **delegateOut) {
  static NGNURLSessionDelegate *delegate;
  static NSURLSession *session;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    delegate = [NGNURLSessionDelegate new];
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.defaultSessionConfiguration;
    config.HTTPCookieStorage = NSHTTPCookieStorage.sharedHTTPCookieStorage;
    config.HTTPShouldSetCookies = YES;
    config.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyOnlyFromMainDocumentDomain;
    // A dev server's first bundle can take minutes before its first byte.
    config.timeoutIntervalForRequest = 300;
    NSOperationQueue *queue = [NSOperationQueue new];
    queue.maxConcurrentOperationCount = 1;
    queue.name = @"ngn.network";
    session = [NSURLSession sessionWithConfiguration:config delegate:delegate delegateQueue:queue];
  });
  *delegateOut = delegate;
  return session;
}

struct Task final : HttpTask {
  Task(NSURLSessionTask *task, std::shared_ptr<HttpState> state) : task(task), state(std::move(state)) {}
  void cancel() override {
    {
      std::lock_guard lock(state->mutex);
      state->done = true;
    }
    [task cancel];
  }
  NSURLSessionTask *task;
  std::shared_ptr<HttpState> state;
};

class SessionHttp final : public Http {
 public:
  std::unique_ptr<HttpTask> send(HttpRequest request, HttpCallbacks callbacks) override {
    NGNURLSessionDelegate *delegate;
    NSURLSession *session = sharedSession(&delegate);
    auto state = std::make_shared<HttpState>();
    state->callbacks = std::move(callbacks);
    NSURL *url = [NSURL URLWithString:ns(request.url)];
    if (url == nil) {
      if (state->callbacks.onComplete) {
        state->callbacks.onComplete("Invalid URL: " + request.url, false);
      }
      return nullptr;
    }
    NSMutableURLRequest *r = [NSMutableURLRequest requestWithURL:url];
    r.HTTPMethod = ns(request.method);
    for (const auto &[name, value] : request.headers) {
      [r addValue:ns(value) forHTTPHeaderField:ns(name)];
    }
    if (!request.body.empty()) {
      r.HTTPBody = [NSData dataWithBytes:request.body.data() length:request.body.size()];
    }
    if (request.timeoutMs > 0) {
      r.timeoutInterval = request.timeoutMs / 1000.0;
    }
    r.HTTPShouldHandleCookies = request.withCredentials;
    NSURLSessionDataTask *task = [session dataTaskWithRequest:r];
    [delegate addTask:task state:state];
    [task resume];
    return std::make_unique<Task>(task, state);
  }

  void clearCookies(std::function<void(bool)> done) override {
    NSHTTPCookieStorage *storage = NSHTTPCookieStorage.sharedHTTPCookieStorage;
    NSArray<NSHTTPCookie *> *cookies = storage.cookies;
    for (NSHTTPCookie *cookie in cookies) {
      [storage deleteCookie:cookie];
    }
    if (done) {
      done(cookies.count > 0);
    }
  }
};

struct Connection final : WebSocketConnection {
  Connection(NSURLSessionWebSocketTask *task, std::shared_ptr<SocketState> state) : task(task), state(std::move(state)) {}
  ~Connection() override {
    close(1001, "");
  }
  void sendText(const std::string &text) override {
    [task sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:ns(text)] completionHandler:^(NSError *) {}];
  }
  void sendBinary(const std::string &data) override {
    NSData *d = [NSData dataWithBytes:data.data() length:data.size()];
    [task sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithData:d] completionHandler:^(NSError *) {}];
  }
  void ping() override {
    [task sendPingWithPongReceiveHandler:^(NSError *) {}];
  }
  void close(int code, const std::string &reason) override {
    if (task.state == NSURLSessionTaskStateCompleted || task.state == NSURLSessionTaskStateCanceling) {
      return;
    }
    NSData *r = [NSData dataWithBytes:reason.data() length:reason.size()];
    [task cancelWithCloseCode:(NSURLSessionWebSocketCloseCode)code reason:r];
  }
  NSURLSessionWebSocketTask *task;
  std::shared_ptr<SocketState> state;
};

class SessionWebSockets final : public WebSockets {
 public:
  std::unique_ptr<WebSocketConnection> connect(
      const std::string &url,
      const std::vector<std::string> &protocols,
      const Headers &headers,
      WebSocketCallbacks callbacks) override {
    NGNURLSessionDelegate *delegate;
    NSURLSession *session = sharedSession(&delegate);
    auto state = std::make_shared<SocketState>();
    state->callbacks = std::move(callbacks);
    NSURL *u = [NSURL URLWithString:ns(url)];
    if (u == nil) {
      if (state->callbacks.onError) {
        state->callbacks.onError("Invalid URL: " + url);
      }
      return nullptr;
    }
    NSMutableURLRequest *r = [NSMutableURLRequest requestWithURL:u];
    for (const auto &[name, value] : headers) {
      [r setValue:ns(value) forHTTPHeaderField:ns(name)];
    }
    if (!protocols.empty()) {
      std::string joined;
      for (const auto &p : protocols) {
        joined += (joined.empty() ? "" : ", ") + p;
      }
      [r setValue:ns(joined) forHTTPHeaderField:@"Sec-WebSocket-Protocol"];
    }
    // Long-lived: the dev server connection idles for as long as nothing changes.
    r.timeoutInterval = 60 * 60 * 24;
    NSURLSessionWebSocketTask *task = [session webSocketTaskWithRequest:r];
    task.maximumMessageSize = 64 * 1024 * 1024;
    [delegate addSocket:task state:state];
    [task resume];
    return std::make_unique<Connection>(task, state);
  }
};

} // namespace

std::shared_ptr<Http> makeHttp() {
  return std::make_shared<SessionHttp>();
}

std::shared_ptr<WebSockets> makeWebSockets() {
  return std::make_shared<SessionWebSockets>();
}

} // namespace ngn::appkit
