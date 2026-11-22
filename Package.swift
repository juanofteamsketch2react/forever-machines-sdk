// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForeverMachines",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ForeverMachines", targets: ["ForeverMachines"])],
    targets: [
        .binaryTarget(
            name: "FMCore",
            url: "https://github.com/juanofteamsketch2react/forever-machines-sdk/releases/download/0.4.2/FMCore.xcframework.zip",
            checksum: "bfd5ac7e4ea1eff58c6394b27b6ba23f61391642a5748b7bc4ff523e824d9dfe"
        ),
        .target(
            name: "ForeverMachines",
            dependencies: ["FMCore"],
            resources: [.copy("Resources/fm")],
            linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Accelerate"), .linkedFramework("AVFoundation")]
        ),
    ]
)
