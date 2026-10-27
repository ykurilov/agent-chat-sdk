import Foundation
import SwiftUI
import AgentChatClient
import YKDesign
import UniformTypeIdentifiers
import ImageIO
#if canImport(PhotosUI)
import PhotosUI
#endif
#if canImport(UIKit)
import UIKit
import QuickLook
#endif

/// One draft context per conversation; bytes and upload state are owned by the durable client.
@MainActor @Observable public final class AgentChatAttachmentController {
    public let chatId: String
    public private(set) var files: [ChatDraftAttachment] = []
    public private(set) var progress: [String: Double] = [:]
    public private(set) var localURLs: [String: URL] = [:]
    public var error: String?
    private let client: AgentChatClient
    public init(client: AgentChatClient, chatId: String) { self.client = client; self.chatId = chatId }
    public var readyAttachmentIds: [String] { files.compactMap { $0.uploaded?.id } }
    public var isReady: Bool { files.allSatisfy { $0.uploaded != nil && $0.error == nil } }
    public func observe() async {
        for await state in await client.updates() {
            if Task.isCancelled { return }
            files = await client.draftAttachments(chatId: chatId); progress = state.uploadProgress
            var urls: [String: URL] = [:]
            for file in files { urls[file.id] = await client.attachmentLocalURL(id: file.id) }
            localURLs = urls
        }
    }
    public func addFile(_ url: URL) async {
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do { if ["heic", "heif"].contains(url.pathExtension.lowercased()) { await addImage(try Data(contentsOf: url, options: .mappedIfSafe)) } else { try await client.uploadAttachment(chatId: chatId, fileURL: url); error = nil } }
        catch { if case ChatClientError.http(_, let kind) = error, kind == "too_large" { self.error = "Файл больше допустимого размера" } else if case ChatClientError.http(_, let kind) = error, kind == "too_many_unsent" { self.error = "Лимит файлов в черновиках исчерпан. Уберите часть вложений" } else { self.error = "Файл не добавлен. Проверьте доступ к нему" } }
    }
    public func addImage(_ data: Data) async {
        do {
            let prepared = try await Task.detached(priority: .userInitiated) { try Self.preparePhoto(data) }.value
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: directory) }
            let url = directory.appendingPathComponent("Photo.jpg"); try prepared.write(to: url)
            try await client.uploadAttachment(chatId: chatId, fileURL: url); error = nil
        } catch { self.error = "Не удалось подготовить фото" }
    }
    /// Thumbnail decoding avoids creating a full-resolution HEIC/48MP bitmap. Metadata is not copied.
    nonisolated public static func preparePhoto(_ data: Data) throws -> Data {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: 2048] as CFDictionary) else { throw ChatClientError.invalidResponse }
        for quality in [0.85, 0.7, 0.5] {
            let bytes = NSMutableData()
            guard let output = CGImageDestinationCreateWithData(bytes, UTType.jpeg.identifier as CFString, 1, nil) else { throw ChatClientError.invalidResponse }
            CGImageDestinationAddImage(output, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
            if CGImageDestinationFinalize(output), 4 * ((bytes.length + 2) / 3) <= 5 * 1024 * 1024 { return bytes as Data }
        }
        throw ChatClientError.http(status: 413, kind: "too_large")
    }
    public func remove(_ id: String) async { do { try await client.removeUnsentAttachment(id, chatId: chatId); error = nil } catch { self.error = "Файл не удалён. Проверьте связь" } }
    public func retry(_ id: String) async { do { try await client.retryAttachment(id) } catch { self.error = "Не удалось сохранить повтор загрузки" } }
}

public struct AgentChatDraftAttachments: View {
    let controller: AgentChatAttachmentController
    public init(controller: AgentChatAttachmentController) { self.controller = controller }
    public var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s2) {
            ForEach(controller.files) { file in
                HStack(spacing: YKTokens.Space.s2) {
                    #if canImport(UIKit)
                    if let url = controller.localURLs[file.id], let image = UIImage(contentsOfFile: url.path) {
                        Image(uiImage: image).resizable().scaledToFit().frame(width: 44, height: 44).clipShape(RoundedRectangle(cornerRadius: YKTokens.Space.s2))
                    } else { YKIcon(.file, size: 22).foregroundStyle(YKColorRole.muted.color) }
                    #else
                    YKIcon(.file, size: 22).foregroundStyle(YKColorRole.muted.color)
                    #endif
                    VStack(alignment: .leading, spacing: YKTokens.Space.s1) {
                        Text(file.name).ykText(.small).lineLimit(1)
                        if let error = file.error {
                            Text(error).ykText(.small).foregroundStyle(YKColorRole.danger.color)
                            Button("Повторить") { Task { await controller.retry(file.id) } }.buttonStyle(.yk(.link, size: .sm))
                        } else if file.uploaded == nil { YKSteps(total: 10, done: Int((controller.progress[file.id] ?? 0) * 10), isLive: true, width: nil).accessibilityLabel("Загрузка " + file.name) }
                    }
                    Spacer(minLength: 0)
                    YKIconButton(.x, label: "Убрать " + file.name, variant: .secondary, size: .sm) { Task { await controller.remove(file.id) } }
                }.accessibilityIdentifier("attachment-draft-" + file.id)
            }
            if let error = controller.error { Text(error).ykText(.small).foregroundStyle(YKColorRole.danger.color) }
        }.foregroundStyle(YKColorRole.text.color).padding(.horizontal, YKTokens.Space.s2)
    }
}

public struct AgentChatAttachmentButton: View {
    let controller: AgentChatAttachmentController
    @State private var showFiles = false
    #if canImport(PhotosUI)
    @State private var showPhotos = false
    @State private var photo: PhotosPickerItem?
    #endif
    #if canImport(UIKit)
    @State private var showCamera = false
    #endif
    public init(controller: AgentChatAttachmentController) { self.controller = controller }
    public var body: some View {
        Menu {
            #if canImport(PhotosUI)
            Button("Фото из галереи") { showPhotos = true }
            #endif
            #if canImport(UIKit)
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Снять фото") {
                    if Bundle.main.object(forInfoDictionaryKey: "NSCameraUsageDescription") != nil { showCamera = true }
                    else { controller.error = "Приложение не настроило доступ к камере" }
                }
            }
            #endif
            Button("Из Файлов") { showFiles = true }
        } label: { YKIcon(.plus, size: 21).foregroundStyle(YKColorRole.text.color).frame(width: 40, height: 40) }
        .accessibilityLabel("Прикрепить").accessibilityIdentifier("attach")
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            switch result { case .success(let urls): Task { for url in urls { await controller.addFile(url) } }; case .failure: controller.error = "Файлы не выбраны" }
        }
        #if canImport(PhotosUI)
        .photosPicker(isPresented: $showPhotos, selection: $photo, matching: .images)
        .onChange(of: photo) { _, item in
            guard let item else { return }
            Task { do { if let bytes = try await item.loadTransferable(type: Data.self) { await controller.addImage(bytes) } } catch { controller.error = "Не удалось прочитать фото" }; photo = nil }
        }
        #endif
        #if canImport(UIKit)
        .sheet(isPresented: $showCamera) { AttachmentCamera { data in showCamera = false; if let data { Task { await controller.addImage(data) } } } }
        #endif
    }
}

/// Authorized download through AgentChatClient; no bearer token is placed in a URL.
public struct AgentChatMessageAttachments: View {
    let attachments: [ChatAttachment]; let chatId: String; let client: AgentChatClient
    public init(_ attachments: [ChatAttachment], chatId: String, client: AgentChatClient) { self.attachments = attachments; self.chatId = chatId; self.client = client }
    public var body: some View { VStack(alignment: .leading, spacing: YKTokens.Space.s2) { ForEach(attachments) { file in AttachmentRow(file: file, chatId: chatId, client: client) } } }
}
private struct AttachmentRow: View {
    let file: ChatAttachment; let chatId: String; let client: AgentChatClient
    @State private var url: URL?; @State private var error: String?; @State private var opening = false
    var body: some View {
        VStack(alignment: .leading, spacing: YKTokens.Space.s1) {
            Button {
                Task { do { if url == nil { url = try await client.downloadAttachment(chatId: chatId, attachment: file) }; opening = true; error = nil } catch { self.error = "Не удалось загрузить файл" } }
            } label: {
                HStack(spacing: YKTokens.Space.s2) {
                    #if canImport(UIKit)
                    if file.kind == "image", let url, let image = UIImage(contentsOfFile: url.path) { Image(uiImage: image).resizable().scaledToFit().frame(maxWidth: 180, maxHeight: 160) }
                    else { YKIcon(file.kind == "image" ? .image : .file, size: 24) }
                    #else
                    YKIcon(.file, size: 24)
                    #endif
                    VStack(alignment: .leading) { Text(file.name).ykText(.small).lineLimit(2); Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)).ykText(.small).foregroundStyle(YKColorRole.muted.color) }
                }.padding(YKTokens.Space.s3).background(YKColorRole.surface2.color, in: RoundedRectangle(cornerRadius: YKTokens.Radius.lg))
            }.buttonStyle(.plain).foregroundStyle(YKColorRole.text.color).accessibilityLabel("Открыть " + file.name)
            if let error { Text(error).ykText(.small).foregroundStyle(YKColorRole.danger.color) }
            #if !canImport(UIKit)
            if let url { ShareLink(item: url) { Text("Сохранить файл") } }
            #endif
        }
        .task(id: file.id) { if file.kind == "image", url == nil { url = try? await client.downloadAttachment(chatId: chatId, attachment: file) } }
        #if canImport(UIKit)
        .sheet(isPresented: $opening) { if let url { AttachmentPreview(url: url) } }
        #endif
    }
}
#if canImport(UIKit)
private struct AttachmentCamera: UIViewControllerRepresentable {
    let finish: (Data?) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(finish) }
    func makeUIViewController(context: Context) -> UIImagePickerController { let view = UIImagePickerController(); view.sourceType = .camera; view.delegate = context.coordinator; return view }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let finish: (Data?) -> Void; init(_ finish: @escaping (Data?) -> Void) { self.finish = finish }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { finish(nil) }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { finish((info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.95)) }
    }
}
private struct AttachmentPreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url) }
    func makeUIViewController(context: Context) -> QLPreviewController { let view = QLPreviewController(); view.dataSource = context.coordinator; return view }
    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}
    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL; init(_ url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
    }
}
#endif
