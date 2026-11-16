// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License: free to try and for non-commercial use,
// commercial use needs a license. See LICENSE (https://forevermachines.net/sdk/LICENSE.txt).
//
// Forever Machines, native: generative audio that never repeats and ends by itself. The same API as the web SDK
// (@forevermachines/sdk), with the machines running natively (FM Core: QuickJS and the apps' own audio engine).
//
//   let fm = FMSession()
//   let tide = try await fm.mount("slow-tide")
//   try fm.power(true)
//   tide.macro(1, 0.4)
//   fm.drift(true)
//   fm.windDown(minutes: 30)
import AVFoundation
import CoreGraphics
import FMCore
import Foundation
#if canImport(MediaPlayer)
import MediaPlayer
#endif

public enum FMError: Error, LocalizedError {
    case notFound(String), boot(String)
    public var errorDescription: String? {
        switch self {
        case .notFound(let s): return "no machine called \(s)"
        case .boot(let s): return "the machine did not start: \(s)"
        }
    }
}

/// One of a machine's controls. Macro 1–8 are the first eight knobs (not the tempo), then switches and menus.
public struct FMControl: Sendable, Hashable {
    public let key: String, label: String, kind: String, section: String
    public let value: Double
    /// What it shows: a knob's value with its unit, a switch's state, a menu's choice, a readout.
    public let text: String?
    /// A menu's choices, in order (set it with v = index / (count - 1)).
    public let options: [String]
}

@MainActor
public final class FMSession {
    public struct Options: Sendable {
        /// Where machines not bundled with the SDK are fetched from.
        public var base = URL(string: "https://forevermachines.net")!
        /// Machines may fetch over the network (the weather for m.world, from Open-Meteo). false: no network at all.
        public var network = true
        /// Play along with other apps' audio instead of interrupting it.
        public var mixWithOthers = false
        /// Show the session on the lock screen and in Control Center, with play and pause.
        public var nowPlaying: String? = nil
        public init() {}
    }

    public let options: Options
    public private(set) var machines: [FMMachine] = []
    /// Called once a second while winding down, and when it starts, ends or is cancelled.
    public var onWind: ((WindState) -> Void)?
    public var wind: WindState { winder.state }
    public private(set) var isPlaying = false

    let output: AudioOutput
    private let winder = Wind()
    private var driftOn = false, bpm = 0.0
    private var observers: [NSObjectProtocol] = []
    var catalogCache: (at: Date, list: [FMCatalogEntry])?
    var effectsCache: [FMEffect]?

    public init(options: Options = Options()) {
        self.options = options
        #if os(iOS) || os(tvOS) || os(visionOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: options.mixWithOthers ? [.mixWithOthers] : [])
        #endif
        output = AudioOutput()
        winder.apply = { [weak self] v in self?.all(#"{"fm":"wind","v":\#(v)}"#) }
        winder.tempo = { [weak self] f in guard let self, self.bpm > 0 else { return }; self.all(#"{"fm":"tempo","bpm":\#(self.bpm * f),"anchor":0}"#) }
        winder.stop = { [weak self] in try? self?.power(false) }
        winder.change = { [weak self] s in self?.onWind?(s) }
        #if os(iOS) || os(tvOS) || os(visionOS)
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, raw == AVAudioSession.InterruptionType.ended.rawValue else { return }
            MainActor.assumeIsolated { if let self, self.isPlaying { try? self.output.start() } }
        })
        #endif
        setUpNowPlaying()
    }

    /// Mounts a machine by name: one bundled with the SDK (the six sleep machines: slow-tide, night-choir, seven-bowls,
    /// lotus-pond, rain-window, long-breath), else /machines/<name>.js from `options.base` (a species of the collection,
    /// e.g. "loom"; for a numbered machine exactly as the site plays it, use mount(number:)).
    /// effect: a Forever Effect's id (see effects()) run inside the machine, at effectMix.
    public func mount(_ name: String, skin: String? = nil, seed: Double = 1, effect: String? = nil, effectMix: Double = 0.5) async throws -> FMMachine {
        if let url = Bundle.module.url(forResource: name, withExtension: "js", subdirectory: "fm/machines"),
           let code = try? String(contentsOf: url, encoding: .utf8) {
            return try await mount(code: code, name: name, skin: skin, seed: seed, effect: effect, effectMix: effectMix)
        }
        return try await mount(url: options.base.appendingPathComponent("machines/\(name).js"), name: name, skin: skin, seed: seed, effect: effect, effectMix: effectMix)
    }

    /// Mounts No. `number` of the collection exactly as the site plays it: its species, seed, skin and name (see catalog();
    /// a bonus machine is 501 and up, as in its address). Needs the network the first time.
    public func mount(number: Int, effect: String? = nil, effectMix: Double = 0.5) async throws -> FMMachine {
        guard let c = try await catalog().first(where: { $0.number == number }) else { throw FMError.notFound("No. \(number)") }
        let code = try await fetchText(options.base.appendingPathComponent("machines/\(c.file)"))
        let extra = #"{"index":\#(c.number - 1),"no":"\#(c.no)","original":\#(c.original)}"#
        return try await mount(code: code, name: c.name, skin: c.themeJSON, seed: c.seed, effect: effect, effectMix: effectMix, extra: extra)
    }

    /// Mounts a machine from any URL.
    public func mount(url: URL, name: String? = nil, skin: String? = nil, seed: Double = 1, effect: String? = nil, effectMix: Double = 0.5) async throws -> FMMachine {
        let code = try await fetchText(url)
        return try await mount(code: code, name: name ?? url.deletingPathExtension().lastPathComponent, skin: skin, seed: seed, effect: effect, effectMix: effectMix)
    }

    /// Mounts a machine from its source.
    public func mount(code: String, name: String, skin: String? = nil, seed: Double = 1, effect: String? = nil, effectMix: Double = 0.5) async throws -> FMMachine {
        try await mount(code: code, name: name, skin: skin, seed: seed, effect: effect, effectMix: effectMix, extra: "{}")
    }

    func mount(code: String, name: String, skin: String?, seed: Double, effect: String?, effectMix: Double, extra: String) async throws -> FMMachine {
        let fx = try await loadEffect(effect)
        let spec = FMMachine.Spec(code: code, name: name, skin: skin ?? "", seed: seed, extra: extra, effect: fx, effectMix: effectMix)
        let m = FMMachine(core: try boot(spec, state: "{}"), spec: spec, session: self)
        machines.append(m)
        output.set(machines.map(\.core))
        return m
    }

    // a core for the machine, started and told what the session is doing
    func boot(_ s: FMMachine.Spec, state: String, playing: Bool? = nil) throws -> FMCoreMachine {
        let root = Bundle.module.url(forResource: "fm", withExtension: nil)!.path
        let core = FMCoreMachine(root: root, sampleRate: output.sampleRate)
        var extra = s.extra
        if let fx = s.effect, extra.hasSuffix("}") {   // (the effect's title, for its section)
            let t = String(data: try JSONSerialization.data(withJSONObject: [fx.title]), encoding: .utf8)!.dropFirst().dropLast()
            extra = String(extra.dropLast()) + (extra == "{}" ? "" : ",") + #""insertTitle":\#(t)}"#
        }
        do {
            try core.bootCode(s.code, name: s.name, skin: s.skin, state: state, seed: s.seed, effect: s.effect?.code ?? "", effectMix: s.effectMix, extra: extra)
        } catch { throw FMError.boot(error.localizedDescription) }
        core.start(withFPS: 30)
        core.post(#"{"fm":"power","on":\#(playing ?? isPlaying)}"#)
        if driftOn { core.post(#"{"fm":"drift","on":true}"#) }
        if bpm > 0 { core.post(#"{"fm":"tempo","bpm":\#(bpm),"anchor":0}"#) }
        if winder.state.on { core.post(#"{"fm":"wind","v":\#(winder.state.v)}"#) }
        return core
    }

    func swapped() { output.set(machines.map(\.core)) }

    func fetchText(_ url: URL) async throws -> String {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode ?? 200 < 300, let s = String(data: data, encoding: .utf8) else {
            throw FMError.notFound(url.absoluteString)
        }
        return s
    }

    /// Every machine on or off. On iOS, add "audio" to UIBackgroundModes so it plays on with the screen locked.
    public func power(_ on: Bool) throws {
        if on { try output.start() }
        isPlaying = on
        all(#"{"fm":"power","on":\#(on)}"#)
        for m in machines { m.isPlaying = on }
        if !on { DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in if self?.isPlaying == false { self?.output.pause() } } }
        updateNowPlaying()
    }

    /// The first smooth knobs wander slowly, so it never repeats exactly.
    public func drift(_ on: Bool) { driftOn = on; all(#"{"fm":"drift","on":\#(on)}"#) }

    /// A shared tempo for the machines that can follow one (0: each its own).
    public func tempo(_ bpm: Double) { self.bpm = max(0, bpm); all(#"{"fm":"tempo","bpm":\#(self.bpm),"anchor":0}"#) }

    /// The music ends by itself in about `minutes` (1–240): never exactly, never twice alike. Starts the machines if
    /// nothing is playing.
    @discardableResult
    public func windDown(minutes: Double = 30) -> WindState {
        if !isPlaying { try? power(true) }
        return winder.start(minutes: minutes)
    }

    public func cancelWindDown() { winder.cancel() }

    public func stop() { winder.cancel(); try? power(false) }

    func remove(_ m: FMMachine) {
        machines.removeAll { $0 === m }
        output.set(machines.map(\.core))
    }

    private func all(_ json: String) { for m in machines { m.post(json) } }

    private func setUpNowPlaying() {
        #if os(iOS)
        guard options.nowPlaying != nil else { return }
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { try? self?.power(true) }; return .success }
        c.pauseCommand.addTarget { [weak self] _ in MainActor.assumeIsolated { self?.stop() }; return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            MainActor.assumeIsolated { guard let self else { return }; if self.isPlaying { self.stop() } else { try? self.power(true) } }
            return .success
        }
        #endif
    }

    private func updateNowPlaying() {
        #if os(iOS)
        guard let title = options.nowPlaying else { return }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: "Forever Machines",
            MPNowPlayingInfoPropertyPlaybackRate: isPlaying ? 1.0 : 0.0, MPNowPlayingInfoPropertyIsLiveStream: true,
        ]
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
        #endif
    }
}

@MainActor
public final class FMMachine {
    struct Spec { var code, name, skin: String; var seed: Double; var extra: String; var effect: FMEffectCode?; var effectMix: Double }

    public var name: String { spec.name }
    public internal(set) var isPlaying = false
    /// The Forever Effect running inside it, if any (its title).
    public var effectTitle: String? { spec.effect?.title }
    private(set) var core: FMCoreMachine
    private var spec: Spec
    private weak var session: FMSession?

    init(core: FMCoreMachine, spec: Spec, session: FMSession) {
        self.core = core; self.spec = spec; self.session = session
        isPlaying = session.isPlaying
        wire()
    }

    private func wire() {
        core.onRequest = { [weak self, network = session?.options.network ?? true] json in Task { @MainActor in self?.answer(json, network: network) } }
    }

    /// Puts a Forever Effect inside the machine (its id, from effects()), or takes it off (nil). The machine starts again
    /// with the same knobs, power, drift and wind; the amount can then move freely with effectMix.
    public func effect(_ id: String?, mix: Double? = nil) async throws {
        guard let session else { return }
        spec.effect = try await session.loadEffect(id)
        if let mix { spec.effectMix = mix }
        let state = core.evaluate("JSON.stringify(__fmState || {})")
        let next = try session.boot(spec, state: state.isEmpty ? "{}" : state, playing: isPlaying)
        let old = core
        core = next
        wire()
        session.swapped()
        old.stop()
    }

    /// How much of the effect (0–1), without restarting.
    public func effectMix(_ v: Double) {
        spec.effectMix = min(1, max(0, v))
        post(#"{"fm":"insert-mix","v":\#(spec.effectMix)}"#)
    }

    /// The output's loudest moment since last asked (0 to about 1), for a meter or a lantern.
    public var level: Float { core.takePeak() }

    public func power(_ on: Bool) { isPlaying = on; post(#"{"fm":"power","on":\#(on)}"#) }

    /// The colours of the skin it wears, as CSS colours by role: page, page-ink, dev (the device), head, line, ink, dim,
    /// accent, accent2, accent-ink, track, field, field-ink, screen, screen-ink, screen-alt, screen-dim. Enough to dress a
    /// panel of your own in the machine's look.
    public var colors: [String: String] {
        let json = core.evaluate("JSON.stringify((globalThis.__fmTheme && __fmTheme.vars) || {})")
        return (try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String]) ?? [:]
    }

    /// The machine's controls, in Macro order first.
    public func controls() -> [FMControl] {
        let json = core.evaluate("__fmDeliver({ fm: 'controls', native: true }); JSON.stringify(__fmControls)")
        guard let list = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else { return [] }
        return list.compactMap { c in
            guard let key = c["key"] as? String, let kind = c["kind"] as? String else { return nil }
            return FMControl(key: key, label: c["label"] as? String ?? "", kind: kind, section: c["sec"] as? String ?? "",
                             value: c["v"] as? Double ?? 0, text: c["text"] as? String, options: c["options"] as? [String] ?? [])
        }
    }

    /// Macro 1–8: the first eight knobs (not the tempo), then switches and menus. The same as the web SDK and Live.
    public func macros() -> [FMControl] {
        let all = controls(), tempo = try! Regex("^(tempo|bpm|speed)$").ignoresCase()
        let knobs = all.filter { $0.kind == "knob" && $0.label.wholeMatch(of: tempo) == nil }
        return Array((knobs + all.filter { $0.kind == "toggle" || $0.kind == "select" }).prefix(8))
    }

    /// Moves Macro n (1–8) to v (0–1). false if the machine has no such macro.
    @discardableResult
    public func macro(_ n: Int, _ v: Double) -> Bool {
        let list = macros()
        guard n >= 1, n <= list.count else { return false }
        set(list[n - 1].key, v)
        return true
    }

    /// Sets any control by its key (from controls()) to v (0–1).
    public func set(_ key: String, _ v: Double) {
        let k = String(data: try! JSONSerialization.data(withJSONObject: [key], options: [.fragmentsAllowed]), encoding: .utf8)!.dropFirst().dropLast()
        post(#"{"fm":"cc","key":\#(k),"v":\#(min(1, max(0, v)))}"#)
    }

    /// Presses one of the machine's buttons (kind "button"), by its key.
    public func press(_ key: String) {
        let k = String(data: try! JSONSerialization.data(withJSONObject: [key], options: [.fragmentsAllowed]), encoding: .utf8)!.dropFirst().dropLast()
        post(#"{"fm":"press","key":\#(k)}"#)
    }

    /// A MIDI note, answered in the machine's own voice.
    public func note(_ n: Int, velocity: Int = 100, on: Bool = true) { post(#"{"fm":"note-in","n":\#(n),"v":\#(velocity),"on":\#(on)}"#) }

    /// The machine's screen as last drawn, for a device view of your own (nil until it has one). Size in points: screenSize.
    public func screenImage() -> CGImage? { core.copyScreenImage() }
    /// Lays the machine's screen out at this size, in points: the machines that can (all six sleep machines) redraw to
    /// fill it, tall or wide, instead of keeping their own proportions. Call it again when your view changes size.
    public func fitScreen(width: Double, height: Double) {
        post(#"{"fm":"focus","mode":"screen","fill":{"w":\#(Int(width)),"h":\#(Int(height))}}"#)
    }
    public var screenSize: CGSize { core.screenSize }
    /// A touch on the screen, in its points: "pointerdown", "pointermove", "pointerup".
    public func pointer(_ type: String, x: Double, y: Double, down: Bool) { core.pointer(type, x: x, y: y, buttons: down ? 1 : 0) }
    /// How often the machine runs its timers and draws (10–60). Lower it while nothing shows the screen.
    public var framesPerSecond: Double { get { core.fps } set { core.fps = newValue } }

    public func destroy() { core.stop(); session?.remove(self) }

    func post(_ json: String) { core.post(json) }

    // what the page asks for: a fetch (the weather), the mic. Anything else is told it is not here.
    func answer(_ json: String, network: Bool) {
        guard let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], let id = o["id"] as? Int else {
            if let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any], o["type"] as? String == "mic" {
                _ = core.evaluate("__fmMic(0, { error: 'no microphone here' })")
            }
            return
        }
        let reply = { [core] (v: [String: Any]) in
            let d = (try? JSONSerialization.data(withJSONObject: v)).flatMap { String(data: $0, encoding: .utf8) } ?? #"{"error":"bad reply"}"#
            core.reply(to: Int32(id), json: d)
        }
        guard o["type"] as? String == "fetch", network, let s = o["url"] as? String, let url = URL(string: s) else {
            reply(["error": "not available here"]); return
        }
        var req = URLRequest(url: url)
        req.httpMethod = o["method"] as? String ?? "GET"
        if let b = o["body"] as? String { req.httpBody = Data(b.utf8) }
        URLSession.shared.dataTask(with: req) { data, response, error in
            if let error { reply(["error": error.localizedDescription]); return }
            reply(["status": (response as? HTTPURLResponse)?.statusCode ?? 200, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""])
        }.resume()
    }
}
