// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ForeverMachines",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "ForeverMachines", targets: ["ForeverMachines"])],
    targets: [
        .binaryTarget(
            name: "FMCore",
            url: "https://github.com/juanofteamsketch2react/forever-machines-sdk/releases/download/0.3.2/FMCore.xcframework.zip",
            checksum: "ff683dbae8e849ed4b5d355f3a2f2b3d3715eba645ae99e229aad0f142c08c6f"
        ),
        .target(
            name: "ForeverMachines",
            dependencies: ["FMCore"],
            resources: [.copy("Resources/fm")],
            linkerSettings: [.linkedLibrary("c++"), .linkedFramework("Accelerate"), .linkedFramework("AVFoundation")]
        ),
    ]
)
