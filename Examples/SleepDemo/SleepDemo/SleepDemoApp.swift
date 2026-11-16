import ForeverMachines
import SwiftUI

@main
struct SleepDemoApp: App {
    var body: some Scene { WindowGroup { ContentView().preferredColorScheme(.dark) } }
}

// the six places of the retreat, as on forevermachines.net/sleep: a machine each, its skin's colours, its picture
struct Place: Identifiable {
    let id, name, place, when, sub, view: String
    let page, ink, accent: Color
}

extension Color {
    init(hex: String) {
        let v = UInt64(hex.dropFirst(), radix: 16) ?? 0
        self.init(red: Double((v >> 16) & 255) / 255, green: Double((v >> 8) & 255) / 255, blue: Double(v & 255) / 255)
    }
}

enum Retreat {
    static let places: [Place] = [
        Place(id: "slow-tide", name: "Slow Tide", place: "The beach", when: "after dark", sub: "The sea at night, and a boat that is going nowhere.", view: "tide", page: Color(hex: "#070a1c"), ink: Color(hex: "#c9d0ff"), accent: Color(hex: "#ff3d9a")),
        Place(id: "night-choir", name: "Night Choir", place: "The sala", when: "late", sub: "Five voices, one slow chord, five lanterns.", view: "choir", page: Color(hex: "#12001f"), ink: Color(hex: "#e2c6ff"), accent: Color(hex: "#b26bff")),
        Place(id: "seven-bowls", name: "Seven Bowls", place: "The table", when: "evening sitting", sub: "Metal bowls and a patient hand.", view: "bowls", page: Color(hex: "#140c06"), ink: Color(hex: "#f3dcc0"), accent: Color(hex: "#ffb347")),
        Place(id: "lotus-pond", name: "Lotus Pond", place: "The pond", when: "past midnight", sub: "Drops in key, crickets, one frog with opinions.", view: "pond", page: Color(hex: "#04141a"), ink: Color(hex: "#cdeee6"), accent: Color(hex: "#ff8fc0")),
        Place(id: "rain-window", name: "Rain Window", place: "The hut", when: "while it rains", sub: "Rain on warm glass, tea going cold.", view: "rain", page: Color(hex: "#0f160e"), ink: Color(hex: "#e9e4cf"), accent: Color(hex: "#ff9d6b")),
        Place(id: "long-breath", name: "Long Breath", place: "The lookout", when: "first light", sub: "In, and a bell, and slowly out.", view: "breath", page: Color(hex: "#1a1024"), ink: Color(hex: "#ffe3d2"), accent: Color(hex: "#ff9a6b")),
    ]
    private static var cache: [String: UIImage] = [:]
    // the skins the site's sleep page dresses each machine in (some are its own, in no list)
    static let skins: [String: Any] = {
        guard let path = Bundle.main.path(forResource: "sleep-skins", ofType: "json"), let d = FileManager.default.contents(atPath: path),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return [:] }
        return o
    }()
    static func skinJSON(_ id: String) -> String? {
        guard let t = skins[id], let d = try? JSONSerialization.data(withJSONObject: t) else { return nil }
        return String(data: d, encoding: .utf8)
    }
    static func image(_ name: String) -> UIImage? {
        if let i = cache[name] { return i }
        guard let path = Bundle.main.path(forResource: name, ofType: "webp"), let i = UIImage(contentsOfFile: path) else { return nil }
        cache[name] = i
        return i
    }
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
    @Published var lamp = 0.45          // the lanterns: on while it plays, dimming as it winds down, out when it is over
    @Published var controls: [FMControl] = []
    @Published var wind = WindState()
    @Published var error: String?
    @Published var current = Retreat.places[0]
    @Published var skin = Skin()
    var editing: String?   // the control a finger is on: not refreshed under it
    private var box = CGSize.zero
    private var ticks = 0

    init() {
        fm.onWind = { [weak self] s in self?.wind = s }
        Timer.scheduledTimer(withTimeInterval: 1 / 15, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    func fit(_ size: CGSize) {
        box = size
        if size.width > 10 { machine?.fitScreen(width: size.width, height: size.height) }
    }

    private func tick() {
        guard let m = machine else { return }
        picture = m.screenImage()
        ticks += 1
        if ticks % 4 == 0 {
            level = m.level
            if editing == nil { controls = m.controls().filter { $0.kind != "steps" } }
            if ticks % 60 == 0 { print("FMDEMO level=\(String(format: "%.3f", level)) playing=\(fm.isPlaying) machine=\(m.name) controls=\(controls.count) lamp=\(String(format: "%.2f", lamp))") }
        }
        let target = wind.wound ? 0 : !fm.isPlaying ? 0.45 : wind.on ? min(1, 0.08 + wind.left * 1.1) : 1
        let flicker = fm.isPlaying ? Double(min(1, level)) * 0.12 : 0
        lamp += (min(1, target * (0.9 + flicker)) - lamp) * 0.08
    }

    func use(_ place: Place) async {
        guard place.id != machine?.name || machine == nil else { return }
        current = place
        machine?.destroy()
        controls = []
        do {
            machine = try await fm.mount(place.id, skin: Retreat.skinJSON(place.id))
            skin = Skin(vars: machine?.colors ?? [:])
            fit(box)
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
    @State private var finger: CGPoint?

    var body: some View {
        let pl = p.current
        ZStack {
            pl.page.ignoresSafeArea()
            backdrop(pl)
            ScrollViewReader { scroller in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header(pl)
                    HStack(spacing: 12) {
                        Button { if p.fm.isPlaying { p.fm.stop() } else { try? p.fm.power(true) } } label: {
                            Label(p.fm.isPlaying ? "Pause" : "Play", systemImage: p.fm.isPlaying ? "pause.fill" : "play.fill")
                                .font(.headline).padding(.horizontal, 22).padding(.vertical, 12)
                                .background(pl.accent, in: Capsule()).foregroundStyle(pl.page)
                        }
                        Button { p.fm.windDown(minutes: 1) } label: {
                            Text(p.wind.on ? "Ends in about \(p.wind.minutesLeft) min" : p.wind.wound ? "Wound down. Sleep well." : "Wind down in 1 min")
                                .font(.subheadline).padding(.horizontal, 16).padding(.vertical, 12)
                                .background(.ultraThinMaterial, in: Capsule()).foregroundStyle(pl.ink)
                        }
                    }
                    places(pl)
                    HStack(alignment: .firstTextBaseline, spacing: 14) {
                        Text("THE MACHINE").font(.caption.monospaced().weight(.bold)).tracking(3).foregroundStyle(pl.accent)
                        Text("its own device, in the kit's look").font(.subheadline.italic()).foregroundStyle(pl.ink.opacity(0.7))
                    }
                    .padding(.top, 8)
                    device.id("device")
                    if let e = p.error { Text(e).foregroundStyle(.red) }
                }
                .padding(.horizontal, 18).padding(.bottom, 30)
            }
            .onChange(of: p.controls.count) { _ in
                if ProcessInfo.processInfo.arguments.contains("-show-device") { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { withAnimation { if ProcessInfo.processInfo.arguments.contains("-dials") { scroller.scrollTo("device-end", anchor: .bottom) } else { scroller.scrollTo("device", anchor: .top) } } } }   // (for screenshots)
            }
            }
        }
        .tint(pl.accent)
        .foregroundStyle(pl.ink)
        .animation(.easeInOut(duration: 0.6), value: pl.id)
        .task {
            let a = ProcessInfo.processInfo.arguments, i = a.firstIndex(of: "-place")
            let id = i.flatMap { a.indices.contains($0 + 1) ? a[$0 + 1] : nil }
            await p.use(Retreat.places.first { $0.id == id } ?? Retreat.places[0])
        }
    }

    // the place itself: the Blender still with its lanterns out, and lit over it as far as the music lets them
    func backdrop(_ pl: Place) -> some View {
        GeometryReader { g in
            ZStack {
                if let off = Retreat.image("\(pl.view)-p-off") { Image(uiImage: off).resizable().scaledToFill() }
                if let on = Retreat.image("\(pl.view)-p-on") { Image(uiImage: on).resizable().scaledToFill().opacity(p.lamp) }
                LinearGradient(colors: [.clear, .clear, pl.page.opacity(0.75), pl.page], startPoint: .top, endPoint: .bottom)
            }
            .frame(width: g.size.width, height: g.size.height).clipped()
        }
        .ignoresSafeArea()
        .id(pl.view)
        .transition(.opacity)
    }

    func header(_ pl: Place) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Spacer(minLength: 0).frame(height: UIScreen.main.bounds.height * 0.32)
            Text("\(pl.place) · \(pl.when)".uppercased()).font(.caption.monospaced()).tracking(2).foregroundStyle(pl.accent)
            Text(pl.name.uppercased()).font(.system(size: 48, weight: .black)).minimumScaleFactor(0.6).lineLimit(1)
            Text(pl.sub).font(.title3.italic()).foregroundStyle(pl.ink.opacity(0.85))
        }
        .shadow(color: .black.opacity(0.5), radius: 12)
    }

    // the six places, all in view: two rows of three, each with its picture
    func places(_ pl: Place) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(Retreat.places) { place in
                let on = pl.id == place.id
                Button { Task { await p.use(place) } } label: {
                    ZStack(alignment: .bottomLeading) {
                        if let t = Retreat.image("thumb-\(place.view)") { Image(uiImage: t).resizable().scaledToFill() }
                        LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(place.name).font(.caption.weight(.bold)).lineLimit(1).minimumScaleFactor(0.7)
                            Text(place.place).font(.caption2).opacity(0.75)
                        }
                        .foregroundStyle(.white).padding(7)
                    }
                    .frame(height: 74).frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(on ? pl.accent : .white.opacity(0.12), lineWidth: on ? 2 : 1))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // the machine as the site shows it: its device in its skin's colours, the screen inside, the dials below in its sections
    var device: some View {
        let k = p.skin
        return VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button { if p.fm.isPlaying { p.fm.stop() } else { try? p.fm.power(true) } } label: {
                    Circle().fill(p.fm.isPlaying ? k.color("accent") : k.color("dim").opacity(0.5)).frame(width: 26, height: 26)
                        .shadow(color: p.fm.isPlaying ? k.color("accent").opacity(0.8) : .clear, radius: 8)
                }
                .buttonStyle(.plain)
                Text(p.current.name).font(.headline.weight(.bold)).foregroundStyle(k.color("ink"))
                Spacer()
                Text("No. 001").font(.caption).foregroundStyle(k.color("dim")).lineLimit(1)
                Meter(level: p.level, on: k.color("accent2"), off: k.color("track"))
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(k.color("head"))
            Rectangle().fill(k.color("line")).frame(height: 1)
            VStack(alignment: .leading, spacing: 8) {
                screen.overlay(RoundedRectangle(cornerRadius: 10).stroke(k.color("line")))
                Text("Touch and hold the screen to play it").font(.caption).foregroundStyle(k.color("dim")).frame(maxWidth: .infinity)
            }
            .padding(14)
            ForEach(p.sections, id: \.0) { name, list in
                Rectangle().fill(k.color("line")).frame(height: 1)
                VStack(alignment: .leading, spacing: 12) {
                    Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(k.color("dim"))
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 4), alignment: .center, spacing: 16) {
                        ForEach(list.filter { $0.kind == "knob" }, id: \.key) { c in Dial(c: c, p: p, k: k) }
                    }
                    ForEach(list.filter { $0.kind != "knob" }, id: \.key) { c in Widget(c: c, p: p, k: k) }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .overlay(alignment: .bottom) { Color.clear.frame(height: 1).id("device-end") }
        .background(k.color("dev"))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(k.color("line")))
        .shadow(color: .black.opacity(0.45), radius: 24, y: 10)
    }

    // tall: the machine lays its own screen out to fill the box (fitScreen), so there is plenty to touch
    var screen: some View {
        GeometryReader { g in
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.4)
                if let img = p.picture { Image(decorative: img, scale: 2).resizable().scaledToFill() }
                // a soft ring under the finger: the touch is seen at once, whatever the machine does with it
                if let f = finger {
                    Circle().stroke(.white.opacity(0.6), lineWidth: 2).frame(width: 68, height: 68).position(f).allowsHitTesting(false)
                }
            }
            .frame(width: g.size.width, height: g.size.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { v in
                    guard let m = p.machine else { return }
                    let k = m.screenSize.width > 0 ? m.screenSize.width / g.size.width : 1
                    m.pointer(finger == nil ? "pointerdown" : "pointermove", x: v.location.x * k, y: v.location.y * k, down: true)
                    finger = v.location
                }
                .onEnded { v in
                    guard let m = p.machine else { return }
                    let k = m.screenSize.width > 0 ? m.screenSize.width / g.size.width : 1
                    m.pointer("pointerup", x: v.location.x * k, y: v.location.y * k, down: false)
                    finger = nil
                })
            .onAppear { p.fit(g.size) }
            .onChange(of: g.size) { s in p.fit(s) }
        }
        .aspectRatio(3 / 4, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.12)))
    }
}

// the machine's skin: its colours by role (machine.colors)
struct Skin {
    var vars: [String: String] = [:]
    func color(_ role: String) -> Color {
        let fallback = ["dev": "#1d2a30", "head": "#22323a", "line": "#2f4650", "ink": "#e6f2ef", "dim": "#7fa3a0", "accent": "#ff8fc0",
                        "accent2": "#5cf2c8", "track": "#2a3d44", "field": "#0c1a1e", "field-ink": "#e6f2ef", "screen": "#061014"]
        return Color(hex: vars[role] ?? fallback[role] ?? "#888888")
    }
}

// a knob as the kit draws it: a 270° track, the value in the accent, a needle; drag up or down to turn it
struct Dial: View {
    let c: FMControl
    @ObservedObject var p: Player
    let k: Skin
    @State private var v = 0.0
    @State private var from: Double?

    var body: some View {
        VStack(spacing: 6) {
            Text(c.label).font(.subheadline).foregroundStyle(k.color("ink")).lineLimit(1).minimumScaleFactor(0.7)
            ZStack {
                Circle().trim(from: 0, to: 0.75).stroke(k.color("track"), style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(135))
                Circle().trim(from: 0, to: 0.75 * v).stroke(k.color("accent2"), style: StrokeStyle(lineWidth: 5, lineCap: .round)).rotationEffect(.degrees(135))
                Rectangle().fill(k.color("ink")).frame(width: 2.5, height: 15).offset(y: -9).rotationEffect(.degrees(-135 + 270 * v))
            }
            .frame(width: 46, height: 46)
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { g in
                    if from == nil { from = v; p.editing = c.key }
                    v = min(1, max(0, from! - g.translation.height / 180))
                    p.machine?.set(c.key, v)
                }
                .onEnded { _ in from = nil; p.editing = nil })
            Text(c.text ?? "").font(.subheadline.monospacedDigit()).foregroundStyle(k.color("ink")).lineLimit(1)
        }
        .onAppear { v = c.value }
        .onChange(of: c.value) { n in if p.editing != c.key { v = n } }
    }
}

// the rest of a machine's controls, in its colours: a menu, a switch, a button, a readout
struct Widget: View {
    let c: FMControl
    @ObservedObject var p: Player
    let k: Skin

    var body: some View {
        switch c.kind {
        case "select":
            HStack {
                Text(c.label).font(.subheadline).foregroundStyle(k.color("ink"))
                Spacer()
                Menu {
                    ForEach(Array(c.options.enumerated()), id: \.offset) { i, name in
                        Button(name) { p.machine?.set(c.key, c.options.count > 1 ? Double(i) / Double(c.options.count - 1) : 0) }
                    }
                } label: {
                    HStack(spacing: 10) { Text(c.text ?? ""); Image(systemName: "arrowtriangle.down.fill").font(.caption2) }
                        .font(.subheadline).foregroundStyle(k.color("field-ink"))
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(k.color("field"), in: RoundedRectangle(cornerRadius: 4))
                        .overlay(RoundedRectangle(cornerRadius: 4).stroke(k.color("line")))
                }
            }
        case "toggle":
            Button { p.machine?.set(c.key, c.value > 0.5 ? 0 : 1) } label: {
                HStack {
                    Text(c.label).font(.subheadline).foregroundStyle(k.color("ink"))
                    Spacer()
                    Text(c.text ?? (c.value > 0.5 ? "On" : "Off")).font(.caption.weight(.bold))
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(c.value > 0.5 ? k.color("accent2") : k.color("track"), in: Capsule())
                        .foregroundStyle(c.value > 0.5 ? k.color("dev") : k.color("ink"))
                }
            }
            .buttonStyle(.plain)
        case "button":
            Button { p.machine?.press(c.key) } label: {
                Text(c.text?.isEmpty == false ? c.text! : c.label).font(.subheadline.weight(.semibold)).foregroundStyle(k.color("ink"))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(k.color("track"), in: RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
        case "readout":
            HStack { Text(c.label); Spacer(); Text(c.text ?? "").foregroundStyle(k.color("accent2")) }.font(.subheadline).foregroundStyle(k.color("ink"))
        default:
            EmptyView()
        }
    }
}

// the level, as the kit's header shows it: a row of small bars
struct Meter: View {
    let level: Float
    let on: Color, off: Color
    var body: some View {
        HStack(spacing: 1.5) {
            ForEach(0..<14, id: \.self) { i in
                Rectangle().fill(Float(i) / 14 < min(1, level) ? on : off).frame(width: 3, height: 12)
            }
        }
    }
}
