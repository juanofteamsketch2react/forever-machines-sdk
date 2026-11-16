# Forever Machines SDK for iOS and Android

Generative audio for sleep, meditation, reading and focus apps: soundscapes that never repeat and end by themselves.
A machine is a few kilobytes of code, not hours of audio, and carries no royalties.

The machines run natively on the device (no WebView): the same engine as the Forever Machines app, so they keep playing
with the screen locked. Six sleep machines are bundled and play offline; the rest of the collection is fetched from
[forevermachines.net](https://forevermachines.net) by name.

On the web, use the JavaScript SDK instead: `npm install @forevermachines/sdk` ([manual](https://forevermachines.net/manual/#sdk), [live demo](https://forevermachines.net/sleep/)).

## iOS and macOS (Swift Package Manager)

In Xcode: File → Add Package Dependencies → `https://github.com/juanofteamsketch2react/forever-machines-sdk`. Or in `Package.swift`:

```swift
.package(url: "https://github.com/juanofteamsketch2react/forever-machines-sdk", from: "0.2.0")
```

```swift
import ForeverMachines

let fm = FMSession()                          // FMSession(options:) for Now Playing, mixing, network
let tide = try await fm.mount("slow-tide")    // bundled; any other name is fetched from forevermachines.net
try fm.power(true)                            // from a tap
tide.macro(1, 0.4)                            // Macro 1–8: the machine's first eight knobs
fm.drift(true)                                // the knobs wander, so it never repeats
fm.windDown(minutes: 30)                      // thins out, darkens, fades, stops in about 30 minutes
```

To keep playing with the screen locked, add **Audio** to the target's Background Modes (`UIBackgroundModes: audio`).
`options.nowPlaying = "A night by the sea"` puts it on the lock screen with play and pause. iOS 16+, macOS 13+.

## Android (Gradle)

In `settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        google(); mavenCentral()
        maven("https://juanofteamsketch2react.github.io/forever-machines-sdk/maven")
    }
}
```

In the app's `build.gradle.kts`: `implementation("net.forevermachines:sdk:0.2.0")`

```kotlin
import net.forevermachines.sdk.FMSession

val fm = FMSession(context)
val tide = fm.mount("slow-tide")              // off the main thread: it may download
fm.power(true)
tide.macro(1, 0.4)
fm.drift(true)
fm.windDown(30.0)
```

To keep playing with the screen off, run the session from a foreground service (`foregroundServiceType="mediaPlayback"`).
Android 8+ (API 26), arm64, armv7 and x86_64.

## The API (both platforms, as on the web)

| | |
|---|---|
| `mount(name)` | A machine: bundled (`slow-tide`, `night-choir`, `seven-bowls`, `lotus-pond`, `rain-window`, `long-breath`) or from the collection. Also from a URL or from source. |
| `power(on)` | All machines on or off. |
| `windDown(minutes)` / `cancelWindDown()` | Ends the music by itself in about that many minutes (never exactly, never twice alike). `onWind` reports it. |
| `drift(on)` | The first smooth knobs wander slowly. |
| `tempo(bpm)` | A shared tempo for the machines that follow one. |
| `machine.macro(n, v)`, `macros()`, `controls()`, `set(key, v)` | The machine's knobs. Macro 1–8 are the same as in Ableton Live and the web SDK. |
| `machine.note(n, velocity, on)` | A MIDI note, answered in the machine's own voice. |
| `machine.level` | The output level, for a meter. |
| `machine.screenImage()` / `screenBitmap()`, `pointer(…)` | The machine's own screen, to show and play if you want the device. |

Machines that read the weather ask Open-Meteo for a city guessed from the time zone (no location permission). Turn the
network off with `network = false` in the options.

## License

Free to try and for non-commercial use; a product that earns money needs a license. See [LICENSE](LICENSE)
(also at [forevermachines.net/sdk/LICENSE.txt](https://forevermachines.net/sdk/LICENSE.txt)).
Made by Juan Maguid, [Temperamento](https://temperamento.net).
