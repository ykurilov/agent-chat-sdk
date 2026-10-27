import XCTest
import UIKit
import Vision

final class KeyboardTests: XCTestCase {
    override func setUp() { super.setUp(); continueAfterFailure = false }
    func test0PrepareBrowser() throws { let safari = try openPage("tandem"); safari.terminate() }
    func testOduvanchik() throws { try exercise("oduvanchik") }
    func testTandem() throws { try exercise("tandem") }

    private func openPage(_ skin: String) throws -> XCUIApplication {
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.launch()
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20))
        let start = safari.buttons.matching(NSPredicate(format: "label IN %@", ["Continue", "Start Browsing", "Продолжить", "Начать просмотр"])).firstMatch
        for _ in 0..<3 { if start.waitForExistence(timeout: 3) { start.tap() } else { break } }
        let address = safari.textFields.firstMatch
        XCTAssertTrue(address.waitForExistence(timeout: 15), safari.debugDescription)
        address.tap()
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 10), "Safari navigation keyboard, before fixture navigation")
        let editingAddress = safari.textFields.firstMatch
        editingAddress.typeText(XCUIKeyboardKey.delete.rawValue)
        editingAddress.typeText("http://127.0.0.1:6155/?native&skin=\(skin)\n")
        XCTAssertTrue(safari.webViews.textViews.firstMatch.waitForExistence(timeout: 30))
        XCTAssertTrue(safari.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewport ready closed")).firstMatch.waitForExistence(timeout: 20), safari.debugDescription)
        return safari
    }
    private func scan(_ screenshot: XCUIScreenshot, screenHeight: CGFloat) throws -> [(text: String, top: CGFloat)] {
        let image = try XCTUnwrap(screenshot.image.cgImage)
        let cropHeight = Int(Double(image.height) * 0.7)
        let crop = try XCTUnwrap(image.cropping(to: CGRect(x: 0, y: 0, width: image.width, height: cropHeight)))
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        request.usesCPUOnly = true
        try VNImageRequestHandler(cgImage: crop, orientation: .up, options: [:]).perform([request])
        let height = screenHeight * CGFloat(cropHeight) / CGFloat(image.height)
        return (request.results ?? []).compactMap { observation in
            guard let text = observation.topCandidates(1).first?.string else { return nil }
            return (text, (1 - observation.boundingBox.maxY) * height)
        }
    }
    private func headerTop(_ words: [(text: String, top: CGFloat)]) throws -> CGFloat {
        try XCTUnwrap(words.first { $0.text.lowercased().contains("application") }, "Application header must be visible in screenshot: \(words)").top
    }
    private func exercise(_ skin: String) throws {
        let safari = try openPage(skin)
        defer { safari.terminate() }
        let field = safari.webViews.textViews.firstMatch
        let headerBefore = try headerTop(scan(safari.screenshot(), screenHeight: safari.frame.height))
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 10), safari.debugDescription)
        field.typeText("Keyboard draft")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 10), "OS keyboard must really be open")
        let ready = safari.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewport ready keyboard")).firstMatch
        XCTAssertTrue(ready.waitForExistence(timeout: 15), safari.debugDescription)
        let screenshot = safari.screenshot()
        let shot = XCTAttachment(screenshot: screenshot); shot.name = "\(skin)-keyboard"; shot.lifetime = .keepAlways; add(shot)
        let words = try scan(screenshot, screenHeight: safari.frame.height)
        let headerAfter = try headerTop(words)
        print("SCREEN_HEADER \(skin) before=\(headerBefore) after=\(headerAfter)")
        XCTAssertEqual(headerAfter, headerBefore, accuracy: 2, "Whole-screen header must not pan with keyboard")
        XCTAssertTrue(words.contains { $0.text.lowercased().contains("keyboard") }, "Typed draft must be visible in screenshot: \(words)")
        XCTAssertTrue((field.value as? String)?.contains("Keyboard draft") == true)
        let blur = safari.webViews.buttons["Blur"]
        XCTAssertTrue(blur.waitForExistence(timeout: 5)); blur.tap()
        let blurred = safari.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", ".* blur:[1-9][0-9]* .*" )).firstMatch
        XCTAssertTrue(blurred.waitForExistence(timeout: 10), "Actual DOM Blur handler must run")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForNonExistence(timeout: 10))
        let closed = safari.webViews.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewport ready closed")).firstMatch
        XCTAssertTrue(closed.waitForExistence(timeout: 15), safari.debugDescription)
        let closedShot = XCTAttachment(screenshot: safari.screenshot()); closedShot.name = "\(skin)-closed"; closedShot.lifetime = .keepAlways; add(closedShot)
        let retained = field.value as? String ?? ""
        XCTAssertTrue(retained.contains("Keyboard draft"))
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap(); field.typeText("!")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(ready.waitForExistence(timeout: 15))
        XCTAssertEqual((field.value as? String)?.replacingOccurrences(of: "!", with: ""), retained)
    }
}
