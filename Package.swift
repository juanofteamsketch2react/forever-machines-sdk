// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForeverMachines",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ForeverMachines", targets: ["ForeverMachines"])],
    targets: [
        .binaryTarget(
            name: "FMCore",
            url: "https://github.com/juanofteamsketch2react/forever-machines-sdk/releases/download/0.2.1/FMCore.xcframework.zip",
            checksum: "68e9c3cd8873a4af51b685c6223e2d2fa099c9de66171ef2c22948330fe88db3"
        ),
        .target(
            name: "ForeverMachines",
            dependencies: ["FMCore"],
            resources: [.copy("Resources/fm")],
            linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Accelerate"), .linkedFramework("AVFoundation")]
        ),
    ]
)
