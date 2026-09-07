// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NarrateHelper",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "NarrateHelper",
            path: "Sources/NarrateHelper"
        )
    ]
)
