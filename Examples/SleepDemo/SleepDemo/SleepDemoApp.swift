import ForeverMachines
import SwiftUI

@main
struct SleepDemoApp: App {
    var body: some Scene { WindowGroup { ContentView().preferredColorScheme(.dark) } }
}

@MainActor
final class Player: ObservableObject {
    let fm: FMSession = {
        var o = FMSession.Options()
        o.nowPlaying = "A night by the sea"
        return FMSession(options: o)
    }()
    @Published var machine: FMMachine?
    @Published var picture: CGImage?
    @Published var level: Float = 0
    @Published var controls: [FMControl] = []
    @Published var wind = WindState()
    @Published var error: String?
    var editing: String?   // the control a finger is on: not refreshed under it
    static let places: [(id: String, name: String, where_: String)] = [
        ("slow-tide", "Slow Tide", "The beach"), ("night-choir", "Night Choir", "The sala"), ("seven-bowls", "Seven Bowls", "The table"),
        ("lotus-pond", "Lotus Pond", "The pond"), ("rain-window", "Rain Window", "The hut"), ("long-breath", "Long Breath", "The lookout"),
    ]
    @Published var current = ""
    private var ticks = 0

    init() {
        fm.onWind = { [weak self] s in self?.wind = s }
        Timer.scheduledTimer(withTimeInterval: 1 / 15, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        guard let m = machine else { return }
        picture = m.screenImage()
        ticks += 1
        if ticks % 4 == 0 {
            level = m.level
            if editing == nil { controls = m.controls().filter { $0.kind != "steps" } }
            if ticks % 60 == 0 { print("FMDEMO level=\(String(format: "%.3f", level)) playing=\(fm.isPlaying) machine=\(m.name) controls=\(controls.count)") }
        }
    }

    func use(_ name: String) async {
        guard name != current else { return }
        current = name
        machine?.destroy()
        controls = []
        do {
            machine = try await fm.mount(name)
            controls = machine?.controls().filter { $0.kind != "steps" } ?? []
            if ProcessInfo.processInfo.arguments.contains("-autoplay") { try fm.power(true) }
        } catch { self.error = error.localizedDescription }
    }

    var sections: [(String, [FMControl])] {
        var order: [String] = [], groups: [String: [FMControl]] = [:]
        for c in controls { if groups[c.section] == nil { order.append(c.section) }; groups[c.section, default: []].append(c) }
        return order.map { ($0, groups[$0]!) }
    }
}

struct ContentView: View {
    @StateObject var p = Player()

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                screen
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Player.places, id: \.id) { place in
                            let on = p.current == place.id
                            Button { Task { await p.use(place.id) } } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(place.name).font(.headline)
                                    Text(place.where_).font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(width: 128, height: 64, alignment: .leading)
                                .padding(.horizontal, 14)
                                .background(on ? Color.accentColor.opacity(0.28) : Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(on ? Color.accentColor : .clear, lineWidth: 1.5))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                HStack(spacing: 12) {
                    Button(p.fm.isPlaying ? "Pause" : "Play") { if p.fm.isPlaying { p.fm.stop() } else { try? p.fm.power(true) } }
                        .buttonStyle(.borderedProminent)
                    Button(p.wind.on ? "Winding down: \(p.wind.minutesLeft) min" : p.wind.wound ? "Wound down" : "Wind down in 1 min") { p.fm.windDown(minutes: 1) }
                        .buttonStyle(.bordered)
                }
                ProgressView(value: Double(min(1, p.level)))
                ForEach(p.sections, id: \.0) { name, list in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(name.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(list, id: \.key) { c in ControlRow(c: c, p: p) }
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 14))
                }
                if let e = p.error { Text(e).foregroundStyle(.red) }
            }
            .padding()
        }
        .task { await p.use("slow-tide") }
    }

    // the machine's own screen: drawn by it, and played with a finger
    @ViewBuilder var screen: some View {
        if let img = p.picture, let m = p.machine {
            GeometryReader { g in
                Image(decorative: img, scale: 2).resizable().scaledToFit()
                    .frame(width: g.size.width, height: g.size.height)
                    .gesture(DragGesture(minimumDistance: 0)
                        .onChanged { v in
                            let s = m.screenSize, k = s.width / g.size.width
                            m.pointer(v.translation == .zero ? "pointerdown" : "pointermove", x: v.location.x * k, y: v.location.y * k, down: true)
                        }
                        .onEnded { v in
                            let k = m.screenSize.width / g.size.width
                            m.pointer("pointerup", x: v.location.x * k, y: v.location.y * k, down: false)
                        })
            }
            .aspectRatio(CGFloat(img.width) / CGFloat(max(1, img.height)), contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }
}

struct ControlRow: View {
    let c: FMControl
    @ObservedObject var p: Player
    @State private var v = 0.0

    var body: some View {
        switch c.kind {
        case "knob":
            VStack(alignment: .leading, spacing: 2) {
                HStack { Text(c.label); Spacer(); Text(c.text ?? "").foregroundStyle(.secondary).monospacedDigit() }.font(.subheadline)
                Slider(value: $v, in: 0...1) { on in p.editing = on ? c.key : nil }
                    .onChange(of: v) { n in if p.editing == c.key { p.machine?.set(c.key, n) } }
            }
            .onAppear { v = c.value }
            .onChange(of: c.value) { n in if p.editing != c.key { v = n } }
        case "toggle":
            Toggle(c.label, isOn: Binding(get: { c.value > 0.5 }, set: { p.machine?.set(c.key, $0 ? 1 : 0) })).font(.subheadline)
        case "select":
            HStack {
                Text(c.label)
                Spacer()
                Picker(c.label, selection: Binding(
                    get: { Int((c.value * Double(max(1, c.options.count - 1))).rounded()) },
                    set: { i in p.machine?.set(c.key, c.options.count > 1 ? Double(i) / Double(c.options.count - 1) : 0) })) {
                    ForEach(Array(c.options.enumerated()), id: \.offset) { Text($0.element).tag($0.offset) }
                }
                .labelsHidden()
            }
            .font(.subheadline)
        case "button":
            Button(c.text?.isEmpty == false ? c.text! : c.label) { p.machine?.press(c.key) }.buttonStyle(.bordered)
        case "readout":
            HStack { Text(c.label); Spacer(); Text(c.text ?? "").foregroundStyle(.secondary) }.font(.subheadline)
        default:
            EmptyView()
        }
    }
}
