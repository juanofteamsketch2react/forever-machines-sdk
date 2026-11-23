// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForeverMachines",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ForeverMachines", targets: ["ForeverMachines"])],
    targets: [
        .binaryTarget(
            name: "FMCore",
            url: "https://github.com/juanofteamsketch2react/forever-machines-sdk/releases/download/0.4.4/FMCore.xcframework.zip",
            checksum: "a1bbaa45b810595516524d681b0775701405a7ad6a66f789164ddef432a26d04"
        ),
        .target(
            name: "ForeverMachines",
            dependencies: ["FMCore"],
            resources: [.copy("Resources/fm")],
            linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Accelerate"), .linkedFramework("AVFoundation")]
        ),
    ]
)
