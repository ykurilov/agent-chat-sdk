import SwiftUI
import UIKit
import AgentChatOduvanchik
@MainActor @Observable final class SpeechFixture: AgentChatSpeechRecognizer {
    var events: AsyncStream<AgentChatSpeechEvent>.Continuation?
    var finalOnFinish: String?
    func start() throws -> AsyncStream<AgentChatSpeechEvent> {let p=AsyncStream<AgentChatSpeechEvent>.makeStream();events=p.continuation;return p.stream}
    func finish() {if let finalOnFinish {events?.yield(.final(finalOnFinish));self.finalOnFinish=nil};events?.yield(.finished);events?.finish()}
    func phrase(){finalOnFinish="Привет, менеджер";events?.yield(.partial("Привет, менеджер"))}
    func cancel() {finalOnFinish=nil;events?.finish()}
    func grow() {Task {let words=[" ещё"," несколько"," слов"," растут"," постепенно"," без"," скачков"," текста"," и"," переноса"," подтверждённой"," строки"]
        var tail="";for word in words {tail+=word;events?.yield(.partial(tail));try? await Task.sleep(for:.milliseconds(220))};events?.yield(.final(tail));events?.yield(.finished);events?.finish()}}
}
@MainActor @Observable final class LayoutProbe: NSObject {
    var report="{}"
    var frames:[[String:Double]]=[]
    private var link:CADisplayLink?
    private var oldEditor:UITextView?
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
            frame["editable"]=v.isEditable ? 1:0;frame["firstResponder"]=v.isFirstResponder ? 1:0;frame["marked"]=v.markedTextRange != nil ? 1:0
            frame["placeholderVisible"]=v.subviews.contains(where:{($0 as? UILabel)?.text=="Сообщение" && !$0.isHidden}) ? 1:0
        }
        frames.append(frame)
        let widths=frames.compactMap{$0["width"]},heights=frames.compactMap{$0["height"]};let x=frames.compactMap{$0["prefixX"]},y=frames.compactMap{$0["prefixY"]}
        let deltas=zip(heights,heights.dropFirst()).map{abs($1-$0)}
        let summary:[String:Double] = ["marked":frame["marked"] ?? -1,"editable":frame["editable"] ?? -1,"firstResponder":frame["firstResponder"] ?? -1,"widthRange":(widths.max() ?? 0)-(widths.min() ?? 0),"maxHeightDelta":deltas.max() ?? 0,"prefixXRange":(x.max() ?? 0)-(x.min() ?? 0),"prefixYRange":(y.max() ?? 0)-(y.min() ?? 0),"unified":frame["unified"]!,"placeholderVisible":frame["placeholderVisible"] ?? -1,"heightRange":(heights.max() ?? 0)-(heights.min() ?? 0),"frames":Double(frames.count)]
        report=String(data:try! JSONSerialization.data(withJSONObject:summary,options:.sortedKeys),encoding:.utf8)!
    }
}
@main struct NativeFixture:App {
    @State private var source=SpeechFixture()
    @State private var probe=LayoutProbe()
    @State private var draft="Набрано"
    @State private var enabled=true
    @State private var context="main"
    var body:some Scene {WindowGroup {
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
        }.preferredColorScheme(ProcessInfo.processInfo.arguments.last=="dark" ? .dark:.light).task{probe.start()}
    }}
}
