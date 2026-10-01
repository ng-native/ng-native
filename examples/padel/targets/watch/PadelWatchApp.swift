import SwiftUI
import WatchConnectivity
#if os(watchOS)
import WatchKit
#endif

final class Match: NSObject, ObservableObject, WCSessionDelegate {
  @Published var us = "0"
  @Published var them = "0"
  @Published var games = "0-0"
  @Published var sets = "0-0"
  @Published var winner = ""
  @Published var tiebreak = false
  @Published var reachable = false
  @Published var queued = 0
  private var pending: [[String: Any]] = []

  override init() {
    super.init()
    if WCSession.isSupported() {
      WCSession.default.delegate = self
      WCSession.default.activate()
    }
  }

  func point(_ team: Int) { send(["point": team, "rally": UUID().uuidString]) }

  func undo() { send(["undo": true, "rally": UUID().uuidString]) }

  private func send(_ message: [String: Any]) {
    #if os(watchOS)
    WKInterfaceDevice.current().play(.click)
    #endif
    let session = WCSession.default
    guard session.activationState == .activated, session.isReachable else { return queue(message) }
    session.sendMessage(
      message,
      replyHandler: { reply in DispatchQueue.main.async { self.apply(reply) } },
      errorHandler: { _ in self.queue(message) }
    )
  }

  private func queue(_ message: [String: Any]) {
    DispatchQueue.main.async {
      let session = WCSession.default
      if session.activationState == .activated {
        session.transferUserInfo(message)
      } else {
        self.pending.append(message)
      }
      self.refresh(session)
    }
  }

  private func flush(_ session: WCSession) {
    DispatchQueue.main.async {
      guard session.activationState == .activated else { return }
      let messages = self.pending
      self.pending.removeAll()
      messages.forEach { session.transferUserInfo($0) }
      self.refresh(session)
    }
  }

  private func apply(_ score: [String: Any]) {
    guard let us = score["us"] as? String else { return }
    self.us = us
    them = score["them"] as? String ?? "0"
    games = score["games"] as? String ?? "0-0"
    sets = score["sets"] as? String ?? "0-0"
    winner = score["winner"] as? String ?? ""
    tiebreak = score["tiebreak"] as? Bool ?? false
  }

  private func refresh(_ session: WCSession) {
    DispatchQueue.main.async {
      self.reachable = session.isReachable
      self.queued = session.outstandingUserInfoTransfers.count + self.pending.count
    }
  }

  func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
    let context = session.receivedApplicationContext
    DispatchQueue.main.async { self.apply(context) }
    flush(session)
  }

  #if os(iOS)
  func sessionDidBecomeInactive(_ session: WCSession) {}
  func sessionDidDeactivate(_ session: WCSession) { session.activate() }
  #endif

  func sessionReachabilityDidChange(_ session: WCSession) { refresh(session) }

  func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
    DispatchQueue.main.async { self.apply(context) }
    refresh(session)
  }

  func session(_ session: WCSession, didFinish userInfoTransfer: WCSessionUserInfoTransfer, error: Error?) {
    refresh(session)
  }
}

private let ball = Color(red: 0.84, green: 0.95, blue: 0.24)
private let court = Color(red: 0.04, green: 0.16, blue: 0.40)

struct Scoreboard: View {
  @ObservedObject var match: Match

  var body: some View {
    VStack(spacing: 6) {
      HStack {
        Text("Sets \(match.sets)")
        Spacer()
        Text(match.tiebreak ? "Tiebreak \(match.games)" : "Games \(match.games)")
      }
      .font(.caption2.weight(.semibold))
      .foregroundStyle(.secondary)

      if match.winner.isEmpty {
        HStack(spacing: 6) {
          side("Us", match.us, fill: ball, ink: court) { match.point(0) }
          side("Them", match.them, fill: .white, ink: court) { match.point(1) }
        }
      } else {
        Text("\(match.winner) win")
          .font(.title2.weight(.heavy))
          .foregroundStyle(ball)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      }

      HStack {
        Circle().fill(match.reachable ? ball : .gray).frame(width: 6, height: 6)
        Text(status).font(.caption2).foregroundStyle(.secondary)
        Spacer()
        Button("Undo") { match.undo() }
          .font(.caption2.weight(.semibold))
          .buttonStyle(.plain)
          .foregroundStyle(ball)
      }
    }
    .padding(.horizontal, 4)
  }

  private var status: String {
    if match.queued > 0 { return "\(match.queued) queued" }
    return match.reachable ? "Live" : "Phone away"
  }

  private func side(_ name: String, _ point: String, fill: Color, ink: Color, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      VStack(spacing: 0) {
        Text(point).font(.system(size: 34, weight: .heavy, design: .rounded))
        Text(name).font(.caption.weight(.bold))
      }
      .foregroundStyle(ink)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(fill, in: RoundedRectangle(cornerRadius: 16))
    }
    .buttonStyle(.plain)
  }
}

@main
struct PadelWatchApp: App {
  @StateObject private var match = Match()

  var body: some Scene {
    WindowGroup {
      Scoreboard(match: match)
    }
  }
}
