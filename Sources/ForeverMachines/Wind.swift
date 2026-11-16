// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License.
// Wind down, as sdk/src/wind.js: it plays on for about the time chosen (±15%), then the ending (one to four minutes):
// the machines leave out more and more notes, darken, fade and sag a little in tempo, unevenly, until everything stops.
import Foundation

public struct WindState: Equatable, Sendable {
    public var on = false
    public var ending = false
    public var wound = false
    public var minutes = 0
    public var left = 1.0
    public var v = 0.0
    public var minutesLeft = 0
    public init() {}
    init(on: Bool, ending: Bool, wound: Bool, minutes: Int, left: Double, v: Double, minutesLeft: Int) {
        self.on = on; self.ending = ending; self.wound = wound; self.minutes = minutes; self.left = left; self.v = v; self.minutesLeft = minutesLeft
    }
}

final class Wind {
    static let hush = 4.0

    var apply: (Double) -> Void = { _ in }
    var tempo: (Double) -> Void = { _ in }
    var stop: () -> Void = {}
    var change: (WindState) -> Void = { _ in }
    var now: () -> TimeInterval = { Date().timeIntervalSince1970 }
    var random: () -> Double = { Double.random(in: 0..<1) }

    private var on = false, end = false, fell = false
    private var min = 0, t0 = 0.0, endAt = 0.0, endLen = 0.0, v = 0.0, left = 1.0, wob = 0.0, hushAt = 0.0
    private var timer: Timer?

    var state: WindState {
        WindState(on: on, ending: end, wound: fell, minutes: min, left: left, v: v,
                  minutesLeft: on ? Swift.max(1, Int(((endAt + endLen - now()) / 60).rounded(.up))) : 0)
    }

    @discardableResult
    func start(minutes: Double) -> WindState {
        var m = minutes.isFinite && minutes > 0 ? minutes : 30
        m = Swift.max(1, Swift.min(240, m.rounded()))
        let t = now()
        let len = (m <= 5 ? m * 60 * 0.4 : Swift.min(240, Swift.max(60, m * 60 * 0.12))) * (0.8 + random() * 0.4)
        on = true; end = false; fell = false; min = Int(m); t0 = t; v = 0; left = 1; wob = random() * 6.3; hushAt = 0; endLen = len
        endAt = t + (m <= 5 ? Swift.max(0, m * 60 - len) * (0.9 + random() * 0.2) : m * 60 * (0.85 + random() * 0.3))
        apply(0)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        change(state)
        return state
    }

    func cancel() { off(fell: false) }

    func tick() {
        guard on else { return }
        let t = now()
        left = Swift.max(0, 1 - (t - t0) / Swift.max(0.001, endAt + endLen - t0))
        if t < endAt { change(state); return }
        end = true
        let u = Swift.min(1, (t - endAt) / endLen)
        v = Swift.min(1, Swift.max(v, u + 0.05 * sin(t / 6.5 + wob) * (1 - u)))
        apply(v)
        tempo(1 - 0.12 * v)
        change(state)
        if u >= 1 {
            if hushAt == 0 { hushAt = t } else if t - hushAt >= Wind.hush { off(fell: true) }
        }
    }

    private func off(fell f: Bool) {
        guard on else { return }
        timer?.invalidate(); timer = nil
        on = false; end = false; v = 0; fell = f
        if f { stop() }
        tempo(1)
        DispatchQueue.main.asyncAfter(deadline: .now() + (f ? 1.5 : 0)) { [weak self] in self?.apply(0) }
        change(state)
    }
}
