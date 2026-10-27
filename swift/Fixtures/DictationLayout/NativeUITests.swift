import XCTest
@MainActor final class NativeUITests:XCTestCase {
    func testFullScreenComposerUsesFullWidthAndKeepsScreenStable() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen"];app.launch()
            let field=app.textViews["composer"]
            XCTAssertTrue(field.waitForExistence(timeout:15))
            XCTAssertGreaterThan(field.frame.width/app.frame.width,0.8,"Controls must not consume the text column")
            app.buttons["dictation-microphone"].tap()
            expectation(for:NSPredicate {_,_ in
                guard let data=app.staticTexts["fixture-metrics"].label.data(using:.utf8),let value=try? JSONDecoder().decode([String:Double].self,from:data) else{return false}
                return (value["editorHeight"] ?? 0)>100 && (value["steadyFrames"] ?? 0)>=12
            },evaluatedWith:field);waitForExpectations(timeout:4)
            // Wait for the one opening transition, then measure the entire screen during speech and final.
            app.buttons["Reset metrics"].tap();app.buttons["Stream"].tap()
            expectation(for:NSPredicate(format:"value ENDSWITH %@","диктовки."),evaluatedWith:field);waitForExpectations(timeout:10)
            expectation(for:NSPredicate(format:"hittable == false"),evaluatedWith:app.buttons["dictation-cancel"]);waitForExpectations(timeout:5)
            let data=try XCTUnwrap(app.staticTexts["fixture-metrics"].label.data(using:.utf8))
            let metrics=try JSONDecoder().decode([String:Double].self,from:data)
            print("SCREEN_METRICS \(theme) \(String(data:data,encoding:.utf8)!)")
            XCTAssertGreaterThan(metrics["historySamples"]!,20)
            XCTAssertGreaterThan(metrics["prefixSamples"]!,20)
            XCTAssertGreaterThan(metrics["widthRatio"]!,0.8)
            for key in ["widthRange","heightRange","globalYRange","globalPrefixXRange","globalPrefixYRange","historyYRange"] {XCTAssertLessThan(metrics[key]!,0.5,key)}
            XCTAssertGreaterThanOrEqual(app.buttons["send"].frame.minY,field.frame.maxY,"Actions belong below the editor")
            let shot=XCTAttachment(screenshot:app.screenshot());shot.name="fullscreen-"+theme;shot.lifetime = .keepAlways;add(shot)
            app.buttons["Clear"].tap()
            expectation(for:NSPredicate {_,_ in field.frame.height<50},evaluatedWith:field);waitForExpectations(timeout:3)
            app.terminate()
        }
    }
    func testFinalSpeechFollowsEndCaretAndPreservesManualSelection() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme];app.launch()
            let field=app.textViews["composer"]
            XCTAssertTrue(field.waitForExistence(timeout:15))
            for prefix in ["","Вопрос:"] {
                app.buttons["Empty"].tap();field.tap()
                if !prefix.isEmpty {field.typeText(prefix)}
                app.buttons["dictation-microphone"].tap();app.buttons["Phrase"].tap()
                let expected=prefix.isEmpty ? "Привет, менеджер":prefix+" Привет, менеджер"
                XCTAssertEqual(field.value as? String,expected)
                // Stop flushes final before finished, just like a recognizer completing speech.
                app.buttons["dictation-microphone"].tap()
                field.typeText("!")
                XCTAssertEqual(field.value as? String,expected+"!","Typing after Stop must follow finalized speech")
            }
            app.buttons["English"].tap();field.tap()
            app.buttons["dictation-microphone"].tap();app.buttons["Phrase"].tap();app.buttons["Caret"].tap()
            app.buttons["dictation-microphone"].tap();field.typeText("!")
            XCTAssertEqual(field.value as? String,"hello! world Привет, менеджер")
            app.buttons["English"].tap();field.tap()
            app.buttons["dictation-microphone"].tap();app.buttons["Phrase"].tap();app.buttons["Select"].tap()
            app.buttons["dictation-microphone"].tap();field.typeText("earth")
            XCTAssertEqual(field.value as? String,"hello earth Привет, менеджер")
            app.terminate()
        }
    }
    func testInlineTextWidthPrefixAndAnimationBothThemes() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme];app.launch()
            let field=app.textViews["composer"]
            XCTAssertTrue(field.waitForExistence(timeout:15),"A single native text container must own confirmed and partial text")
            app.buttons["Reset"].tap();app.buttons["dictation-microphone"].tap()
            app.buttons["Partial"].tap();XCTAssertEqual(field.value as? String,"Набрано кноп")
            app.buttons["Final"].tap();XCTAssertEqual(field.value as? String,"Набрано кноп")
            app.buttons["Suffix"].tap();XCTAssertEqual(field.value as? String,"Набрано кнопка работает")
            app.buttons["Commit"].tap();XCTAssertEqual(field.value as? String,"Набрано кнопка работает")
            app.buttons["Grow"].tap()
            let text=NSPredicate(format:"value ENDSWITH %@","подтверждённой строки");expectation(for:text,evaluatedWith:field);waitForExpectations(timeout:10)
            // Hidden reserved controls may still exist in XCTest; they must cease to be hittable.
            let ended=NSPredicate(format:"hittable == false");expectation(for:ended,evaluatedWith:app.buttons["dictation-cancel"]);waitForExpectations(timeout:5)
            let data=try XCTUnwrap(app.staticTexts["fixture-metrics"].label.data(using:.utf8));let metrics=try JSONDecoder().decode([String:Double].self,from:data)
            print("LAYOUT_METRICS \(theme) \(String(data:data,encoding:.utf8)!)")
            XCTAssertLessThan(metrics["widthRange"]!,1)
            XCTAssertLessThan(metrics["prefixXRange"]!,0.5);XCTAssertLessThan(metrics["prefixYRange"]!,0.5)
            XCTAssertGreaterThan(metrics["heightRange"]!,20);XCTAssertLessThan(metrics["maxHeightDelta"]!,18)
            let screenshot=XCTAttachment(screenshot:app.screenshot());screenshot.name="inline-"+theme;screenshot.lifetime = .keepAlways;add(screenshot)
            app.buttons["Empty"].tap();app.buttons["Reset"].tap();app.buttons["dictation-microphone"].tap();app.buttons["Leading"].tap()
            XCTAssertEqual(field.value as? String,"кнопка")
            let after=try JSONDecoder().decode([String:Double].self,from:app.staticTexts["fixture-metrics"].label.data(using:.utf8)!)
            XCTAssertEqual(after["placeholderVisible"],0)
            app.buttons["Finish"].tap()
            app.buttons["English"].tap();app.buttons["dictation-microphone"].tap();app.buttons["Foo"].tap()
            app.buttons["Select"].tap();app.buttons["Foobar"].tap();field.typeText("earth")
            XCTAssertEqual(field.value as? String,"hello earth foobar")
            app.buttons["Finish"].tap();XCTAssertEqual(field.value as? String,"hello earth")
            field.typeText(" works");XCTAssertEqual(field.value as? String,"hello earth works")
            app.buttons["English"].tap();app.buttons["dictation-microphone"].tap();app.buttons["Foobar"].tap();XCTAssertEqual(field.value as? String,"hello world foobar");app.buttons["Rapid"].tap()
            XCTAssertEqual(field.value as? String,"hello earth foobar")
            app.buttons["Finish"].tap();XCTAssertEqual(field.value as? String,"hello earth")
            app.buttons["Empty"].tap();app.buttons["dictation-microphone"].tap();app.buttons["Hello"].tap();XCTAssertEqual(field.value as? String,"hello");app.buttons["Transient"].tap()
            XCTAssertEqual(field.value as? String,"X hello")
            app.buttons["Finish"].tap();XCTAssertEqual(field.value as? String,"X")
            app.buttons["Empty"].tap();app.buttons["BurstClear"].tap();XCTAssertEqual(field.value as? String,"")
            app.buttons["English"].tap()
            app.buttons["Marked"].tap()
            expectation(for:NSPredicate(format:"label CONTAINS %@","\"marked\":1"),evaluatedWith:app.staticTexts["fixture-metrics"]);waitForExpectations(timeout:3)
            app.buttons["Disable"].tap()
            expectation(for:NSPredicate(format:"label CONTAINS %@ AND label CONTAINS %@","\"editable\":0","\"firstResponder\":0"),evaluatedWith:app.staticTexts["fixture-metrics"]);waitForExpectations(timeout:3)
            let disabled=try JSONDecoder().decode([String:Double].self,from:app.staticTexts["fixture-metrics"].label.data(using:.utf8)!)
            XCTAssertEqual(disabled["editable"],0);XCTAssertEqual(disabled["firstResponder"],0)
            app.buttons["Disable"].tap();app.buttons["Marked"].tap()
            expectation(for:NSPredicate(format:"label CONTAINS %@","\"marked\":1"),evaluatedWith:app.staticTexts["fixture-metrics"]);waitForExpectations(timeout:3)
            app.buttons["Switch"].tap();app.buttons["Late"].tap()
            XCTAssertEqual(field.value as? String,"chat B")
            app.terminate()
        }
    }
}
