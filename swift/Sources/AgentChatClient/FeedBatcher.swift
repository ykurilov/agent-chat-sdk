import Foundation

/// Coalesce bursts for one durable cache write/publication, without waiting for
/// the next network event to deliver an isolated live update. Internal transport
/// buffers are bounded; overflow reconnects from the last durable cursor.
actor ChatFeedBatcher {
    typealias Continuation = AsyncThrowingStream<[ChatFeedEvent], any Error>.Continuation
    private let continuation: Continuation
    private var pending: [ChatFeedEvent] = []
    private var pendingBytes = 0
    private var timer: Task<Void, Never>?
    private var finished = false
    init(_ continuation: Continuation) { self.continuation = continuation }
    func append(_ event: ChatFeedEvent, byteCount: Int = 0) {
        guard !finished else { return }
        if !pending.isEmpty, pendingBytes + byteCount > 256 * 1024 { flush() }
        guard !finished else { return }
        pending.append(event); pendingBytes += max(0, byteCount)
        if pending.count >= 128 || pendingBytes >= 256 * 1024 { flush() }
        else if timer == nil {
            timer = Task { [weak self] in
                do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
                await self?.flush()
            }
        }
    }
    private func flush() {
        timer?.cancel(); timer = nil
        guard !finished, !pending.isEmpty else { return }
        let batch = pending; pending.removeAll(keepingCapacity: true); pendingBytes = 0
        if case .dropped = continuation.yield(batch) {
            finished = true
            continuation.finish(throwing: ChatClientError.invalidResponse)
        }
    }
    func finish(_ error: (any Error)? = nil) {
        guard !finished else { return }
        flush()
        guard !finished else { return }
        finished = true
        continuation.finish(throwing: error)
    }
    func cancel() {
        guard !finished else { return }
        finished = true; timer?.cancel(); timer = nil; pending.removeAll(); pendingBytes = 0
        continuation.finish()
    }
}
