// Copyright (c) 2026 Juan Maguid, Temperamento. Forever Machines SDK License.
// The collection and the Forever Effects, as the site has them. The catalog (which machine is No. N, with its name,
// seed and skin) is computed by the site's own catalog.js from the registry and the date, so it is run here as well:
// on a page of FM Core, with the site's current files (the bundled ones when offline).
import FMCore
import Foundation

/// One machine of the collection, as the site shows it.
public struct FMCatalogEntry: Sendable, Hashable, Identifiable {
    /// 1, 2, 3 … (a bonus machine: 501 and up, as in its address forevermachines.net/501)
    public let number: Int
    /// As the site writes it: "013", or "015½" for a bonus machine.
    public let no: String
    public let name: String
    /// Its species: the machine it is a variation of ("Loom"), and that species' file and id.
    public let species: String
    public let speciesId: String
    public let file: String
    public let seed: Double
    /// Its skin's name (a generated skin has one too, in no list).
    public let skin: String
    public let blurb: String
    public let thought: String
    /// The first of its species (not a variation); a bonus machine (a surprise between the weekly births).
    public let original: Bool
    public let bonus: Bool
    public let born: Date
    public var id: Int { number }
    let themeJSON: String
}

/// A Forever Effect: something that runs inside a machine, in its own audio.
public struct FMEffect: Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let blurb: String
    let file: String
}

struct FMEffectCode { let title: String; let code: String }

extension FMSession {
    /// Every machine born so far, in order, then the bonus machines: number, name, species, seed, skin. Fetched from
    /// options.base (kept 10 minutes); offline, the bundled registry.
    public func catalog() async throws -> [FMCatalogEntry] {
        if let c = catalogCache, Date().timeIntervalSince(c.at) < 600 { return c.list }
        let bundled = { (p: String) in (try? String(contentsOf: Bundle.module.url(forResource: "fm", withExtension: nil)!.appendingPathComponent(p), encoding: .utf8)) ?? "" }
        async let reg = try? fetchText(options.base.appendingPathComponent("machines/registry.json"))
        async let themes = try? fetchText(options.base.appendingPathComponent("themes.js"))
        async let cat = try? fetchText(options.base.appendingPathComponent("catalog.js"))
        let (r, t, c) = await (reg, themes, cat)
        let registry = r ?? bundled("public/machines/registry.json")
        // the three belong together: the site's catalog with the site's skins, or all three bundled
        let online = r != nil && t != nil && c != nil
        let page = FMCoreMachine(root: Bundle.module.url(forResource: "fm", withExtension: nil)!.path, sampleRate: 48000)
        try page.bootPage()
        _ = page.evaluate(online ? t! : bundled("public/themes.js"))
        _ = page.evaluate(online ? c! : bundled("public/catalog.js"))
        let json = page.evaluate("""
            (function (reg) { const b = FMCatalog.build(reg, Date.now());
              return JSON.stringify([...b.catalog, ...b.bonus].map((c) => ({ number: c.i + 1, no: c.no || String(c.i + 1).padStart(3, '0'),
                name: c.name, species: c.arch.title || c.arch.id, speciesId: c.arch.id, file: c.arch.file, seed: c.seed, skin: c.theme.name,
                theme: JSON.stringify(c.theme), blurb: c.arch.blurb || '', thought: c.thought || '', original: !!c.original, bonus: !!c.bonus, born: c.born })));
            })(\(registry))
            """)
        guard let list = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [[String: Any]] else {
            throw FMError.boot("the catalog: \(json.prefix(200))")
        }
        let out = list.map { o in
            FMCatalogEntry(number: o["number"] as? Int ?? 0, no: o["no"] as? String ?? "", name: o["name"] as? String ?? "",
                           species: o["species"] as? String ?? "", speciesId: o["speciesId"] as? String ?? "", file: o["file"] as? String ?? "",
                           seed: o["seed"] as? Double ?? 1, skin: o["skin"] as? String ?? "", blurb: o["blurb"] as? String ?? "",
                           thought: o["thought"] as? String ?? "", original: o["original"] as? Bool ?? false, bonus: o["bonus"] as? Bool ?? false,
                           born: Date(timeIntervalSince1970: (o["born"] as? Double ?? 0) / 1000), themeJSON: o["theme"] as? String ?? "")
        }
        if online { catalogCache = (Date(), out) }
        return out
    }

    /// The Forever Effects collection (those released so far): id, title, blurb.
    public func effects() async throws -> [FMEffect] {
        if let e = effectsCache { return e }
        let text = try await fetchText(options.base.appendingPathComponent("effects/fx/registry.json"))
        guard let o = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any], let list = o["effects"] as? [[String: Any]] else { return [] }
        let iso = ISO8601DateFormatter()
        let out = list.compactMap { e -> FMEffect? in
            if let r = e["release"] as? String, let d = iso.date(from: r) ?? iso.date(from: r + "T00:00:00Z"), d > Date() { return nil }
            guard let id = e["id"] as? String, let file = e["file"] as? String else { return nil }
            return FMEffect(id: id, title: e["title"] as? String ?? id, blurb: e["blurb"] as? String ?? "", file: file)
        }
        effectsCache = out
        return out
    }

    func loadEffect(_ id: String?) async throws -> FMEffectCode? {
        guard let id else { return nil }
        guard let e = try await effects().first(where: { $0.id == id || $0.file == id || $0.file == id + ".js" }) else { throw FMError.notFound("effect \(id)") }
        return FMEffectCode(title: e.title, code: try await fetchText(options.base.appendingPathComponent("effects/fx/\(e.file)")))
    }
}
