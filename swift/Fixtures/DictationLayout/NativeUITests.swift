import XCTest
@MainActor final class NativeUITests:XCTestCase {
    func testLongDictationTailManualScrollAndTypingBothThemes() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen","controls","long"];app.launch()
            let field=app.textViews["composer"],mic=app.buttons["dictation-microphone"]
            XCTAssertTrue(field.waitForExistence(timeout:15));app.buttons["Clear"].tap();mic.tap()
            func metrics()->[String:Double] {let data=app.staticTexts["fixture-metrics"].label.data(using:.utf8)!;return (try? JSONDecoder().decode([String:Double].self,from:data)) ?? [:]}
            func until(_ predicate:@escaping()->Bool,_ timeout:TimeInterval=5) {expectation(for:NSPredicate{_,_ in predicate()},evaluatedWith:field);waitForExpectations(timeout:timeout)}
            func progress()->Int {Int(app.staticTexts["long-progress"].label) ?? 0}
            until({(metrics()["steadyFrames"] ?? 0)>=12 && field.frame.height>100})
            app.buttons["Reset metrics"].tap();app.buttons["Long"].tap()
            until({progress()>=32},12)
            let first=metrics();print("TAIL_AUTO",theme,first)
            XCTAssertGreaterThan(first["overflowSamples"] ?? 0,30)
            XCTAssertEqual(first["hiddenTailFrames"],0)
            XCTAssertLessThan(first["maxOffsetDelta"] ?? 999,12)
            for key in ["widthRange","heightRange","globalYRange","historyYRange"] {XCTAssertLessThan(first[key] ?? 999,0.5,key)}
            let before=first["offset"] ?? 0
            field.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.2)).press(forDuration:0.1,thenDragTo:field.coordinate(withNormalizedOffset:CGVector(dx:0.5,dy:0.85)))
            until({(metrics()["offset"] ?? 999)<before-15})
            app.buttons["Reset metrics"].tap();until({progress()>=48},10)
            let held=metrics();print("TAIL_MANUAL",theme,held)
            XCTAssertLessThan(held["offsetRange"] ?? 999,1)
            XCTAssertEqual(held["tailVisible"],0)
            for _ in 0..<5 {
                if (metrics()["bottomGap"] ?? 999)<2 {break}
                field.swipeUp(velocity:.fast)
            }
            until({(metrics()["bottomGap"] ?? 999)<2})
            app.buttons["Reset metrics"].tap();app.buttons["Long"].tap();until({progress()>=95},15)
            let resumed=metrics();print("TAIL_RESUMED",theme,resumed)
            XCTAssertEqual(resumed["hiddenTailFrames"],0)
            XCTAssertGreaterThan(resumed["overflowSamples"] ?? 0,60)
            XCTAssertLessThan(resumed["maxOffsetDelta"] ?? 999,12)
            for key in ["widthRange","heightRange","globalYRange","historyYRange"] {XCTAssertLessThan(resumed[key] ?? 999,0.5,key)}
            mic.tap();until({!app.buttons["dictation-cancel"].exists && (metrics()["tailVisible"] ?? 0)==1})
            let expected=try XCTUnwrap(field.value as? String)
            let shot=XCTAttachment(screenshot:app.screenshot());shot.name="long-tail-"+theme;shot.lifetime = .keepAlways;add(shot)
            field.coordinate(withNormalizedOffset:CGVector(dx:0.12,dy:0.74)).tap();field.typeText("!")
            XCTAssertEqual(field.value as? String,expected+"!","The first tap after Stop must append at the actual end")
            app.terminate()
        }
    }
    func testComposerReasoningConfirmationAndInsetsBothThemes() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen","controls","reasoning"];app.launch()
            let field=app.textViews["composer"],picker=app.buttons["executor-model"],attach=app.buttons["attach"],send=app.buttons["send"]
            XCTAssertTrue(field.waitForExistence(timeout:15))
            app.buttons["Clear"].tap()
            func shot(_ state:String) {let image=XCTAttachment(screenshot:app.screenshot());image.name="reasoning-"+theme+"-"+state;image.lifetime = .keepAlways;add(image)}
            XCTAssertGreaterThanOrEqual(attach.frame.width,44);XCTAssertGreaterThanOrEqual(attach.frame.height,44)
            XCTAssertLessThan(attach.frame.maxX,picker.frame.minX)
            XCTAssertLessThan(picker.frame.maxX,app.buttons["dictation-microphone"].frame.minX)
            XCTAssertFalse(app.buttons["executor-reasoning"].exists,"No second reasoning button in the composer")
            print("INSET_FRAMES",theme,"attach",attach.frame,"send",send.frame,"editor",field.frame)
            shot("empty")
            app.buttons["Text"].tap();shot("text")
            let width=field.frame.width
            app.buttons["dictation-microphone"].tap()
            expectation(for:NSPredicate {_,_ in field.frame.height>100},evaluatedWith:field);waitForExpectations(timeout:4)
            XCTAssertFalse(picker.isEnabled)
            XCTAssertLessThan(picker.frame.maxX,app.buttons["dictation-cancel"].frame.minX)
            XCTAssertEqual(field.frame.width,width,accuracy:0.5)
            app.buttons["Stream"].tap()
            expectation(for:NSPredicate(format:"value CONTAINS %@","Сегодня"),evaluatedWith:field);waitForExpectations(timeout:3)
            shot("dictation");app.buttons["dictation-cancel"].tap()
            picker.tap()
            let medium=app.buttons["executor-reasoning-medium"]
            XCTAssertTrue(medium.waitForExistence(timeout:3));XCTAssertEqual(medium.label,"Medium")
            shot("menu");medium.tap()
            let sheet=app.sheets.firstMatch
            XCTAssertTrue(sheet.waitForExistence(timeout:3));XCTAssertTrue(sheet.buttons["Сменить"].isHittable)
            XCTAssertEqual(app.staticTexts["model-events"].label,"0:opus:high")
            XCTAssertEqual(picker.value as? String,"Opus 5.5 High")
            shot("before-confirm");sheet.buttons["Отмена"].tap()
            XCTAssertEqual(app.staticTexts["model-events"].label,"0:opus:high")
            picker.tap();app.buttons["executor-reasoning-medium"].tap()
            XCTAssertTrue(sheet.waitForExistence(timeout:3));XCTAssertTrue(sheet.buttons["Сменить"].isHittable);sheet.buttons["Сменить"].tap()
            expectation(for:NSPredicate(format:"label == %@","1:opus:medium"),evaluatedWith:app.staticTexts["model-events"]);waitForExpectations(timeout:3)
            expectation(for:NSPredicate(format:"value == %@","Opus 5.5 Medium"),evaluatedWith:picker);waitForExpectations(timeout:3)
            shot("after-confirm")
            app.terminate()
        }
    }
    func testComposerReasoningWithAllControlsBothThemes() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen","controls","reasoning","agent-stop"];app.launch()
            let field=app.textViews["composer"],picker=app.buttons["executor-model"]
            XCTAssertTrue(field.waitForExistence(timeout:15));app.buttons["Text"].tap()
            let width=field.frame.width
            app.buttons["dictation-microphone"].tap()
            expectation(for:NSPredicate {_,_ in field.frame.height>100},evaluatedWith:field);waitForExpectations(timeout:4)
            let controls=[app.buttons["attach"],picker,app.buttons["stop"],app.buttons["dictation-cancel"],app.buttons["dictation-microphone"],app.buttons["send"]]
            for (left,right) in zip(controls,controls.dropFirst()) {XCTAssertLessThanOrEqual(left.frame.maxX,right.frame.minX,"Controls must not overlap")}
            XCTAssertEqual(field.frame.width,width,accuracy:0.5)
            let image=XCTAttachment(screenshot:app.screenshot());image.name="all-controls-"+theme;image.lifetime = .keepAlways;add(image)
            app.terminate()
        }
    }
    func testComposerControlsAndModelSelectionBothThemes() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen","controls"];app.launch()
            let field=app.textViews["composer"],send=app.buttons["send"],mic=app.buttons["dictation-microphone"],picker=app.buttons["executor-model"]
            XCTAssertTrue(field.waitForExistence(timeout:15))
            app.buttons["Clear"].tap()
            XCTAssertFalse(send.isEnabled)
            XCTAssertFalse(app.buttons["dictation-cancel"].exists)
            XCTAssertLessThan(abs(send.frame.minX-mic.frame.maxX),8)
            XCTAssertEqual(picker.value as? String,"Opus 5.5 High")
            XCTAssertGreaterThan(field.frame.width/app.frame.width,0.8)
            func shot(_ state:String) {let image=XCTAttachment(screenshot:app.screenshot());image.name="controls-"+theme+"-"+state;image.lifetime = .keepAlways;add(image)}
            shot("empty")
            app.buttons["Text"].tap();XCTAssertTrue(send.isEnabled);shot("text")
            let width=field.frame.width
            mic.tap()
            expectation(for:NSPredicate {_,_ in field.frame.height>100},evaluatedWith:field);waitForExpectations(timeout:4)
            XCTAssertTrue(app.buttons["dictation-cancel"].isHittable)
            XCTAssertFalse(picker.isEnabled)
            XCTAssertLessThan(abs(send.frame.minX-mic.frame.maxX),8)
            XCTAssertEqual(field.frame.width,width,accuracy:0.5)
            app.buttons["Stream"].tap()
            expectation(for:NSPredicate(format:"value CONTAINS %@","Сегодня"),evaluatedWith:field);waitForExpectations(timeout:3)
            shot("dictation")
            app.buttons["dictation-cancel"].tap()
            XCTAssertEqual(field.value as? String,"Проверяем новую раскладку композера.")
            picker.tap();app.buttons["Flash"].tap()
            XCTAssertEqual(picker.value as? String,"Opus 5.5 High","Source changes only after confirmation")
            let confirmation=app.sheets.firstMatch
            XCTAssertTrue(confirmation.waitForExistence(timeout:3))
            let confirm=confirmation.buttons["Сменить"]
            XCTAssertTrue(confirm.isHittable)
            shot("before-confirm")
            confirm.tap()
            shot("after-confirm")
            expectation(for:NSPredicate(format:"label == %@","1:flash"),evaluatedWith:app.staticTexts["model-events"]);waitForExpectations(timeout:3)
            print("MODEL_CALLBACK",theme,app.staticTexts["model-events"].label)
            expectation(for:NSPredicate(format:"value == %@","Flash"),evaluatedWith:picker);waitForExpectations(timeout:3)
            picker.tap();app.buttons["Opus 5.5"].tap()
            XCTAssertTrue(confirmation.waitForExistence(timeout:3))
            confirmation.buttons["Отмена"].tap()
            XCTAssertEqual(app.staticTexts["model-events"].label,"1:flash","Cancel must not dispatch another choice")
            XCTAssertEqual(picker.value as? String,"Flash")
            app.terminate()
        }
    }
    func testFullScreenComposerUsesFullWidthAndKeepsScreenStable() throws {
        let app=XCUIApplication()
        for theme in ["light","dark"] {
            app.launchArguments=[theme,"fullscreen","controls"];app.launch()
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
