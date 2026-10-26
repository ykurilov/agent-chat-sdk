// swift-tools-version: 6.0
import PackageDescription
import Foundation

// First slice: add SDK and the canonical design system as local packages.
// The UI dependency is not copied into SDK; a published YKDesign SPM URL can replace this path later.
let designPath = ProcessInfo.processInfo.environment["AGENT_CHAT_YKDESIGN_PATH"] ?? "../YKDesignSystem/swift/YKDesign"
let package = Package(
    name: "AgentChat",
    defaultLocalization: "ru",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AgentChatClient", targets: ["AgentChatClient"]),
        .library(name: "AgentChatOduvanchik", targets: ["AgentChatOduvanchik"]),
    ],
    dependencies: [.package(path: designPath)],
    targets: [
        .target(name: "AgentChatClient", path: "swift/Sources/AgentChatClient"),
        .target(name: "AgentChatOduvanchik", dependencies: ["AgentChatClient", .product(name: "YKDesign", package: "YKDesign")], path: "swift/Sources/AgentChatOduvanchik"),
        .testTarget(name: "AgentChatOduvanchikTests", dependencies: ["AgentChatOduvanchik", "AgentChatClient"], path: "swift/Tests/AgentChatOduvanchikTests"),
        .testTarget(name: "AgentChatClientTests", dependencies: ["AgentChatClient"], path: "swift/Tests/AgentChatClientTests"),
    ]
)
