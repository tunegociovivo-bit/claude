// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NegocioVivoTimeAgent",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "NegocioVivoTimeAgent", targets: ["MacAgent"])],
    targets: [
        .target(name: "AgentCore"),
        .executableTarget(name: "MacAgent", dependencies: ["AgentCore"]),
        .testTarget(name: "AgentCoreTests", dependencies: ["AgentCore"])
    ]
)
