import SwiftUI
import UIKit
import AgentChatOduvanchik
import AgentChatClient
@MainActor @Observable final class SpeechFixture: AgentChatSpeechRecognizer {
    var events: AsyncStream<AgentChatSpeechEvent>.Continuation?
    var finalOnFinish: String?
    func start() throws -> AsyncStream<AgentChatSpeechEvent> {let p=AsyncStream<AgentChatSpeechEvent>.makeStream();events=p.continuation;return p.stream}
    func finish() {if let finalOnFinish {events?.yield(.final(finalOnFinish));self.finalOnFinish=nil};events?.yield(.finished);events?.finish()}
    func phrase(){finalOnFinish="Привет, менеджер";events?.yield(.partial("Привет, менеджер"))}
    func cancel() {finalOnFinish=nil;events?.finish()}
    func screenStream() {Task {
        let words=[" Сегодня"," надо"," проверить"," сборку"," на"," телефоне"," и"," посмотреть"," как"," ведёт"," себя"," лента"," во"," время"," диктовки."]
        var tail=""
        for word in words {tail+=word;events?.yield(.partial(tail));try? await Task.sleep(for:.milliseconds(300))}
        events?.yield(.final(tail));events?.yield(.finished);events?.finish()
    }}
    func grow() {Task {let words=[" ещё"," несколько"," слов"," растут"," постепенно"," без"," скачков"," текста"," и"," переноса"," подтверждённой"," строки"]
        var tail="";for word in words {tail+=word;events?.yield(.partial(tail));try? await Task.sleep(for:.milliseconds(220))};events?.yield(.final(tail));events?.yield(.finished);events?.finish()}}
}
@MainActor @Observable final class LayoutProbe: NSObject {
    var report="{}"
    var frames:[[String:Double]]=[]
    private var link:CADisplayLink?
    private var oldEditor:UITextView?
    private var steadyFrames=0
    private var previousScreenGeometry:[Double]?
    func markComposition(){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {oldEditor=view;view.becomeFirstResponder();view.setMarkedText("中",selectedRange:NSRange(location:1,length:0))}
    }
    func lateComposition(){oldEditor?.unmarkText();if let oldEditor {oldEditor.delegate?.textViewDidChange?(oldEditor)}}
    func start(){link=CADisplayLink(target:self,selector:#selector(tick));link?.add(to:.main,forMode:.common)}
    func reset(){frames=[]}
    private func applyKeyboardEdit(_ view:UITextView,_ replacement:String){
        // insertText is a low-level UITextInput primitive. Reproduce the keyboard's
        // delegate gate and change notification explicitly for same-runloop cases.
        guard view.delegate?.textView?(view,shouldChangeTextIn:view.selectedRange,replacementText:replacement) ?? true else{return}
        view.insertText(replacement)
        view.delegate?.textViewDidChange?(view)
    }
    func rapidWord(){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {
            view.becomeFirstResponder();view.selectedRange=NSRange(location:6,length:5)
            for character in "earth" {applyKeyboardEdit(view,String(character))}
        }
    }
    func burstThenClear(_ clear:()->Void){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {
            view.becomeFirstResponder()
            for character in "new" {applyKeyboardEdit(view,String(character))}
            clear()
        }
    }
    func transientSelectAll(){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {
            view.becomeFirstResponder();view.selectedRange=NSRange(location:0,length:0)
            applyKeyboardEdit(view,"hello")
            view.selectedRange=NSRange(location:0,length:(view.text as NSString).length)
            applyKeyboardEdit(view,"X")
        }
    }
    func caretInMiddle(){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {view.becomeFirstResponder();view.selectedRange=NSRange(location:5,length:0)}
    }
    func selectWord(){
        func descendants(_ v:UIView)->[UIView]{[v]+v.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        if let view=views.first(where:{$0.accessibilityIdentifier=="composer"}) as? UITextView {view.becomeFirstResponder();view.selectedRange=NSRange(location:6,length:5)}
    }
    @objc func tick(){
        func descendants(_ view:UIView)->[UIView]{[view]+view.subviews.flatMap(descendants)}
        let views=UIApplication.shared.connectedScenes.compactMap{$0 as? UIWindowScene}.flatMap(\.windows).flatMap(descendants)
        guard let editor=views.first(where:{$0.accessibilityIdentifier=="composer" && ($0 is UITextView || $0 is UITextField)}) else{return}
        var frame:[String:Double] = ["width":Double(editor.bounds.width),"height":Double(editor.layer.presentation()?.bounds.height ?? editor.bounds.height),"unified":editor is UITextView ? 1:0]
        if let v=editor as? UITextView {
            if v.text.hasPrefix("Набрано") {let range=v.layoutManager.glyphRange(forCharacterRange:NSRange(location:0,length:7),actualCharacterRange:nil);let rect=v.layoutManager.boundingRect(forGlyphRange:range,in:v.textContainer);frame["prefixX"]=Double(rect.minX-v.contentOffset.x);frame["prefixY"]=Double(rect.minY-v.contentOffset.y)}
            let global=v.layer.presentation()?.convert(v.bounds,to:nil) ?? v.convert(v.bounds,to:nil)
            frame["globalY"]=Double(global.minY)
            frame["editorHeight"]=Double(v.bounds.height)
            frame["widthRatio"]=Double(v.bounds.width/(v.window?.bounds.width ?? 1))
            if v.text.hasPrefix("Набрано") {let range=v.layoutManager.glyphRange(forCharacterRange:NSRange(location:0,length:7),actualCharacterRange:nil);let r=v.layoutManager.boundingRect(forGlyphRange:range,in:v.textContainer);frame["globalPrefixX"]=Double(global.minX+r.minX-v.contentOffset.x);frame["globalPrefixY"]=Double(global.minY+r.minY-v.contentOffset.y)}
            if let anchor=views.first(where:{$0.accessibilityIdentifier=="history-probe"}) {let r=anchor.layer.presentation()?.convert(anchor.bounds,to:nil) ?? anchor.convert(anchor.bounds,to:nil);frame["historyY"]=Double(r.minY)}
            frame["editable"]=v.isEditable ? 1:0;frame["firstResponder"]=v.isFirstResponder ? 1:0;frame["marked"]=v.markedTextRange != nil ? 1:0
            frame["placeholderVisible"]=v.subviews.contains(where:{($0 as? UILabel)?.text=="Сообщение" && !$0.isHidden}) ? 1:0
        }
        let geometry=[frame["height"] ?? 0,frame["globalY"] ?? 0]
        if let previousScreenGeometry,zip(geometry,previousScreenGeometry).allSatisfy({abs($0-$1)<0.05}) {steadyFrames+=1} else {steadyFrames=0}
        previousScreenGeometry=geometry
        frames.append(frame)
        let widths=frames.compactMap{$0["width"]},heights=frames.compactMap{$0["height"]};let x=frames.compactMap{$0["prefixX"]},y=frames.compactMap{$0["prefixY"]}
        let deltas=zip(heights,heights.dropFirst()).map{abs($1-$0)}
        let summary:[String:Double] = ["marked":frame["marked"] ?? -1,"editable":frame["editable"] ?? -1,"firstResponder":frame["firstResponder"] ?? -1,"widthRange":(widths.max() ?? 0)-(widths.min() ?? 0),"maxHeightDelta":deltas.max() ?? 0,"prefixXRange":(x.max() ?? 0)-(x.min() ?? 0),"prefixYRange":(y.max() ?? 0)-(y.min() ?? 0),"unified":frame["unified"]!,"placeholderVisible":frame["placeholderVisible"] ?? -1,"heightRange":(heights.max() ?? 0)-(heights.min() ?? 0),"frames":Double(frames.count)]
        func span(_ key:String)->Double {let values=frames.compactMap{$0[key]};return (values.max() ?? 0)-(values.min() ?? 0)}
        var result=summary
        for key in ["globalY","globalPrefixX","globalPrefixY","historyY"] {result[key+"Range"]=span(key)}
        result["editorHeight"]=frame["editorHeight"];result["widthRatio"]=frame["widthRatio"]
        result["steadyFrames"]=Double(steadyFrames)
        result["historySamples"]=Double(frames.filter{$0["historyY"] != nil}.count)
        result["prefixSamples"]=Double(frames.filter{$0["globalPrefixY"] != nil}.count)
        report=String(data:try! JSONSerialization.data(withJSONObject:result,options:.sortedKeys),encoding:.utf8)!
    }
}
private struct HistoryAnchor:UIViewRepresentable {
    func makeUIView(context:Context)->UIView {let view=UIView();view.accessibilityIdentifier="history-probe";return view}
    func updateUIView(_ view:UIView,context:Context) {}
}
@MainActor @Observable final class ModelFixture {
    var state=ChatExecutorModelState(revision:"fixture",models:[ChatExecutorModel(id:"opus",label:"Opus 5.5"),ChatExecutorModel(id:"flash",label:"Flash")],selected:ChatExecutorModelChoice(id:"opus",reasoning:"high"))
    var changes=0
    func select(_ choice:ChatExecutorModelChoice) {changes+=1;state.selected=choice}
}
@main struct NativeFixture:App {
    @State private var source=SpeechFixture()
    @State private var probe=LayoutProbe()
    @State private var draft="Набрано"
    @State private var enabled=true
    @State private var context="main"
    @State private var model=ModelFixture()
    private var controls:Bool {ProcessInfo.processInfo.arguments.contains("controls")}
    private var modelSelection:AgentChatComposerModelSelection? {controls ? AgentChatComposerModelSelection(state:model.state,warning:"Первый ответ дороже и медленнее."){model.select($0)}:nil}
    private let attachments=AgentChatAttachmentController(client:try! AgentChatClient(endpoint:URL(string:"http://127.0.0.1:1/api/conversations")!,accountID:"fixture",cacheURL:FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)){"fixture-only"},chatId:"main")
    private var fullscreen:Bool {ProcessInfo.processInfo.arguments.contains("fullscreen")}
    var body:some Scene {WindowGroup {
        Group {
        if fullscreen {
            VStack(spacing:0) {
                Text("Главный агент").font(.headline).padding()
                if controls {Text("\(model.changes):\(model.state.selected.id)").accessibilityIdentifier("model-events").font(.caption2)}
                HStack {Button("Reset metrics"){probe.reset()};Button("Stream"){source.screenStream()};Button("Clear"){draft=""};if controls {Button("Text"){draft="Проверяем новую раскладку композера."}}}
                Text(probe.report).font(.caption2).lineLimit(1).frame(height:12).accessibilityIdentifier("fixture-metrics")
                ScrollView {
                    VStack(alignment:.leading,spacing:20) {
                        ForEach(0..<8){i in Text("Реплика \(i). Проверяем экран беседы и диктовку.").padding()}
                        Text("Последняя реплика остаётся на месте").padding().background(HistoryAnchor())
                    }.frame(maxWidth:.infinity,alignment:.leading)
                }.defaultScrollAnchor(.bottom)
            }.safeAreaInset(edge:.bottom,spacing:0) {
                AgentChatComposer(text:$draft,placeholder:"Сообщение менеджеру",onStop:controls ? nil:{},enabled:enabled,speechRecognizer:source,speechContextId:context,attachmentController:attachments,modelSelection:modelSelection){draft=""}.padding(.horizontal,12).padding(.vertical,8)
            }
        } else {
        VStack {
            Text(probe.report).font(.caption2).lineLimit(1).frame(height:12).accessibilityIdentifier("fixture-metrics")
            HStack {Button("Reset"){probe.reset()};Button("Partial"){source.events?.yield(.partial("кноп"))};Button("Final"){source.events?.yield(.final("кноп"))};Button("Suffix"){source.events?.yield(.partial("ка работает"))}}
            HStack {Button("Commit"){source.events?.yield(.final("ка работает"))};Button("Grow"){source.grow()};Button("Empty"){draft=""};Button("Leading"){source.events?.yield(.partial(" кнопка"))};Button("Finish"){source.finish()}}
            HStack {Button("English"){draft="hello world"};Button("Select"){probe.selectWord()};Button("Foo"){source.events?.yield(.partial("foo"))};Button("Foobar"){source.events?.yield(.partial("foobar"))}}
            HStack {Button("Marked"){probe.markComposition()};Button("Disable"){enabled.toggle()};Button("Switch"){context="other";draft="chat B"};Button("Late"){probe.lateComposition()}}
            HStack {Button("Rapid"){probe.rapidWord()};Button("Hello"){source.events?.yield(.partial("hello"))};Button("Transient"){probe.transientSelectAll()};Button("BurstClear"){probe.burstThenClear{draft=""}}}
            HStack {Button("Phrase"){source.phrase()};Button("Caret"){probe.caretInMiddle()}}
            AgentChatComposer(text:$draft,placeholder:"Сообщение",enabled:enabled,speechRecognizer:source,speechContextId:context) {draft=""}.padding()
            Spacer()
        }
        }
        }.preferredColorScheme(ProcessInfo.processInfo.arguments.contains("dark") ? .dark:.light).task{probe.start()}
    }}
}
