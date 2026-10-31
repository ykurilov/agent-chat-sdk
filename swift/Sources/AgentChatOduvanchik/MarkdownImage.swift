import Foundation
import SwiftUI
import YKDesign
#if canImport(UIKit)
import UIKit
private typealias MarkdownPlatformImage = UIImage
#elseif canImport(AppKit)
import AppKit
private typealias MarkdownPlatformImage = NSImage
#endif

/// The host resolves/authenticates the original Markdown destination. No path rewriting is applied.
public typealias AgentChatImageLoader = @Sendable (_ address: String) async throws -> Data

private struct MarkdownImageLoaderKey: EnvironmentKey {
    static let defaultValue: AgentChatImageLoader? = nil
}

extension EnvironmentValues {
    public var agentChatImageLoader: AgentChatImageLoader? {
        get { self[MarkdownImageLoaderKey.self] }
        set { self[MarkdownImageLoaderKey.self] = newValue }
    }
}

extension View {
    /// Inherited by AgentChatView and standalone AgentChatMarkdown responses.
    public func agentChatImageLoader(_ loader: @escaping AgentChatImageLoader) -> some View {
        environment(\.agentChatImageLoader, loader)
    }
}

struct MarkdownImage: View {
    let alt: String
    let address: String
    let title: String?
    @Environment(\.agentChatImageLoader) private var loader
    @State private var image: MarkdownPlatformImage?
    @State private var failed = false
    @State private var resolvedAddress: String?

    private var supported: Bool {
        loader != nil || ["http", "https"].contains(URL(string: address)?.scheme?.lowercased() ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s1) {
            if supported {
                // Fixed geometry before and after decode prevents asynchronous reflow.
                Rectangle().fill(YKColorRole.surface2.color)
                    .aspectRatio(4 / 3, contentMode: .fit)
                    .overlay {
                        if resolvedAddress == address, let image {
                            platformImage(image).resizable().scaledToFit()
                                .accessibilityLabel(alt.isEmpty ? (title ?? "Изображение") : alt)
                        } else if resolvedAddress == address, failed {
                            VStack(spacing: YKTokens.Space.s2) {
                                Image(systemName: "photo")
                                Text("Не удалось загрузить картинку").ykText(.small)
                                    .accessibilityIdentifier("markdown-image-error")
                            }.foregroundStyle(YKColorRole.muted.color)
                        } else {
                            ProgressView().accessibilityLabel("Загрузка изображения")
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: YKTokens.Radius.md))
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(resolvedAddress == address ? (image != nil ? "loaded" : (failed ? "failed" : "loading")) : "loading")
                    .accessibilityIdentifier("markdown-image")
            }
            if !alt.isEmpty {
                Text(alt).ykText(.small).foregroundStyle(YKColorRole.muted.color)
                    .textSelection(.enabled)
            }

        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: address) {
            image = nil; failed = false; resolvedAddress = address
            guard supported else { return }
            do {
                let data: Data
                if let loader { data = try await loader(address) }
                else {
                    guard let url = URL(string: address), ["http", "https"].contains(url.scheme?.lowercased() ?? "") else { return }
                    let (body, response) = try await URLSession.shared.data(from: url)
                    guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw URLError(.badServerResponse) }
                    data = body
                }
                try Task.checkCancellation()
                guard let decoded = MarkdownPlatformImage(data: data) else { throw URLError(.cannotDecodeContentData) }
                image = decoded
            } catch {
                // A disappearing/replaced response must not receive a late result.
                if !Task.isCancelled { failed = true }
            }
        }
    }

    private func platformImage(_ value: MarkdownPlatformImage) -> Image {
        #if canImport(UIKit)
        Image(uiImage: value)
        #else
        Image(nsImage: value)
        #endif
    }
}
