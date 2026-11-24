// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License.
// One AVAudioEngine for the session: a source node that renders every mounted machine and sums them.
import AVFoundation
import FMCore
import os

final class AudioOutput {
    let sampleRate: Double
    private var lock = os_unfair_lock()
    private var cores: [FMCoreMachine] = []
    private var scratchL = [Float](repeating: 0, count: 8192)
    private var scratchR = [Float](repeating: 0, count: 8192)

    deinit { if let o = configObserver { NotificationCenter.default.removeObserver(o) } }

    init() {
        #if os(iOS) || os(tvOS) || os(visionOS)
        let rate = AVAudioSession.sharedInstance().sampleRate
        #else
        let rate = 48000.0 // (the engine resamples to the device; asking the device here would wake the hardware)
        #endif
        sampleRate = rate > 0 ? rate : 48000
    }

    // the engine and its source node are made on the first start, not before: nothing touches the audio hardware
    // until something plays
    private var engineStorage: AVAudioEngine?
    private var wanted = false
    private var configObserver: NSObjectProtocol?
    var engine: AVAudioEngine {
        if let e = engineStorage { return e }
        let e = AVAudioEngine()
        let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)!
        let node = AVAudioSourceNode(format: format) { [unowned self] _, _, frameCount, abl in
            self.render(Int(frameCount), UnsafeMutableAudioBufferListPointer(abl))
            return noErr
        }
        e.attach(node)
        e.connect(node, to: e.mainMixerNode, format: format)
        engineStorage = e
        // a new output (headphones, a sample-rate change) stops the engine without a word: start it again if it should play
        configObserver = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: e, queue: .main) { [weak self] _ in
            guard let self, self.wanted, !e.isRunning else { return }
            e.prepare(); try? e.start()
        }
        return e
    }

    func set(_ list: [FMCoreMachine]) {
        os_unfair_lock_lock(&lock); cores = list; os_unfair_lock_unlock(&lock)
    }

    private func render(_ frames: Int, _ abl: UnsafeMutableAudioBufferListPointer) {
        guard abl.count >= 2, let outL = abl[0].mData?.assumingMemoryBound(to: Float.self),
              let outR = abl[1].mData?.assumingMemoryBound(to: Float.self) else { return }
        outL.update(repeating: 0, count: frames); outR.update(repeating: 0, count: frames)
        guard os_unfair_lock_trylock(&lock) else { return }
        defer { os_unfair_lock_unlock(&lock) }
        var off = 0
        while off < frames {
            let n = min(scratchL.count, frames - off)
            for core in cores {
                scratchL.withUnsafeMutableBufferPointer { l in
                    scratchR.withUnsafeMutableBufferPointer { r in
                        core.renderLeft(l.baseAddress!, right: r.baseAddress!, frames: Int32(n))
                        for i in 0..<n { outL[off + i] += l[i]; outR[off + i] += r[i] }
                    }
                }
            }
            off += n
        }
    }

    func start() throws {
        #if os(iOS) || os(tvOS) || os(visionOS)
        try AVAudioSession.sharedInstance().setActive(true)
        #endif
        wanted = true
        if !engine.isRunning { engine.prepare(); try engine.start() }
    }

    func pause() { wanted = false; if let e = engineStorage, e.isRunning { e.pause() } }
    var isRunning: Bool { engineStorage?.isRunning ?? false }
}
