import XCTest
import ImageIO
import UniformTypeIdentifiers
import CoreGraphics
@testable import AgentChatOduvanchik
@MainActor final class AttachmentPhotoTests: XCTestCase {
    func testPhotoIsJPEGWith2048EdgeAndFitsFiveMiBBase64() throws {
        let context = try XCTUnwrap(CGContext(data: nil, width: 4096, height: 2048, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(gray: 0.5, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 4096, height: 2048))
        let image = try XCTUnwrap(context.makeImage()), original = NSMutableData()
        let output = try XCTUnwrap(CGImageDestinationCreateWithData(original, UTType.png.identifier as CFString, 1, nil)); CGImageDestinationAddImage(output, image, nil); XCTAssertTrue(CGImageDestinationFinalize(output))
        let result = try AgentChatAttachmentController.preparePhoto(original as Data)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(result as CFData, nil)); let properties = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertEqual(CGImageSourceGetType(source) as String?, UTType.jpeg.identifier)
        XCTAssertEqual(properties[kCGImagePropertyPixelWidth] as? Int, 2048); XCTAssertEqual(properties[kCGImagePropertyPixelHeight] as? Int, 1024)
        XCTAssertLessThanOrEqual(result.base64EncodedData().count, 5 * 1024 * 1024)
    }
}
