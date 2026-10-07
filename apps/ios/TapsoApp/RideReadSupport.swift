import Foundation
import Network

/// The live polling loop's sleep: it ends after the delay, or at once when
/// something asks for a refresh (`RideReadScheduler.request`) or the loop is
/// cancelled. One sleeper at a time: the ride has one loop.
@MainActor
final class RidePollWaker {
    private var continuation: CheckedContinuation<Void, Never>?
    private var timer: Task<Void, Never>?

    func sleep(seconds: Double) async {
        guard seconds > 0, !Task.isCancelled else { return }
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                self.wake()
                self.continuation = continuation
                self.timer = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(seconds))
                    self?.wake()
                }
            }
        } onCancel: {
            Task { @MainActor in self.wake() }
        }
    }

    /// Ends the current sleep, if any.
    func wake() {
        timer?.cancel()
        timer = nil
        continuation?.resume()
        continuation = nil
    }
}

/// Seconds on a monotonic clock, for `RideReadScheduler`.
enum RideMonotonicClock {
    private static let origin = ContinuousClock.now

    static var now: Double {
        let elapsed = ContinuousClock.now - origin
        return Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
    }
}

/// The phone's network path during a live ride. Context only: a satisfied
/// path does not mean TAPSO's server answers, and an answer is the only proof
/// that tracking works. Used to say *why* a read failed in the trace and to
/// read again as soon as the network comes back.
@MainActor
final class RideNetworkMonitor {
    enum Context: String, Sendable {
        case unknown, satisfied, unsatisfied, cellular, wifi
    }

    private var monitor: NWPathMonitor?
    private(set) var context: Context = .unknown
    /// Called on the main actor when the path goes from unsatisfied to satisfied.
    var onRestored: (() -> Void)?

    func start() {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let next: Context = switch path.status {
            case .satisfied:
                path.usesInterfaceType(.wifi) ? .wifi : path.usesInterfaceType(.cellular) ? .cellular : .satisfied
            case .unsatisfied, .requiresConnection:
                .unsatisfied
            @unknown default:
                .unknown
            }
            Task { @MainActor in self?.update(next) }
        }
        monitor.start(queue: DispatchQueue(label: "tapso.ride.network"))
        self.monitor = monitor
    }

    func stop() {
        monitor?.cancel()
        monitor = nil
        context = .unknown
    }

    private func update(_ next: Context) {
        let wasDown = context == .unsatisfied
        context = next
        if wasDown, next != .unsatisfied, next != .unknown { onRestored?() }
    }
}

extension Duration {
    /// Seconds, for APIs that take `TimeInterval`.
    var timeInterval: TimeInterval {
        Double(components.seconds) + Double(components.attoseconds) / 1e18
    }
}
