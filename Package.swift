// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForeverMachines",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ForeverMachines", targets: ["ForeverMachines"])],
    targets: [
        .binaryTarget(
            name: "FMCore",
            url: "https://github.com/juanofteamsketch2react/forever-machines-sdk/releases/download/0.2.3/FMCore.xcframework.zip",
            checksum: "4be2d5463622cc8467acc762748ccf05a5f7d1966e5a9cce19c8bf22d3bd9e7f"
        ),
        .target(
            name: "ForeverMachines",
            dependencies: ["FMCore"],
            resources: [.copy("Resources/fm")],
            linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Accelerate"), .linkedFramework("AVFoundation")]
        ),
    ]
)
