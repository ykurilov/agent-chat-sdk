// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import { Button, ChatProgress, CompletionCard } from "@ykurilov/ds-react";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { AgentChat } from "../src/chat";
import { fakeChatServer } from "../../../packages/react/tests/support/fake-chat-server";
import { setupChatDom } from "../../../packages/react/tests/support/chat-dom";
setupChatDom();
beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
afterEach(() => vi.restoreAllMocks());

it("renders application header/aside and derives shadow from the single scroll root", async () => {
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 const {container}=render(<AgentChat api="/api/chat" chatId="c1" header={{title:"Application title",aside:<ChatProgress label="Stage two" value={2} max={3}/>}} />);
 await screen.findByRole("heading",{name:"Application title"});
 expect(screen.getByRole("progressbar",{name:"Stage two"}).getAttribute("aria-valuenow")).toBe("2");
 const scroll=container.querySelector('.oduvanchik-thread-scroll')!;
 // CSS is not laid out in jsdom: real scrolling geometry is covered by the browser scenario.
 Object.defineProperty(scroll, 'scrollTop', {configurable:true, writable:true, value:0});
 fireEvent.scroll(scroll,{target:{scrollTop:1}});
 expect(container.querySelector('.yk-chat-header--scrolled')).not.toBeNull();
 fireEvent.scroll(scroll,{target:{scrollTop:0}});
 expect(container.querySelector('.yk-chat-header--scrolled')).toBeNull();
 expect(container.querySelectorAll('.yk-scroll-area')).toHaveLength(1);
});

it("controlled completion preserves the mounted draft, has no invented text and does not steal focus", async () => {
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 function App(){const[done,setDone]=useState(false);return <><button onClick={()=>setDone(true)}>Complete</button><AgentChat api="/api/chat" chatId="c1" completion={done?<CompletionCard title="Application result" items={[{id:"one",label:"Custom item",status:"later",statusLabel:"App later"}]} action={<Button onClick={()=>setDone(false)}>Continue</Button>}/>:undefined}/></>}
 const {container}=render(<App/>);await screen.findByRole("heading",{name:"С чего начнём?"});
 const field=screen.getByRole("textbox",{name:"Сообщение"});fireEvent.change(field,{target:{value:"Unsaved draft"}});
 const complete=screen.getByRole("button",{name:"Complete"});complete.focus();fireEvent.click(complete);
 await screen.findByRole("region",{name:"Application result"});
 expect(screen.queryByRole("textbox",{name:"Сообщение"})).toBeNull();
 expect(container.querySelector('textarea')).toBe(field);
 expect(document.activeElement).toBe(complete);
 expect(within(screen.getByRole("log")).getByText("App later")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Continue"}));
 expect(screen.getByRole("textbox",{name:"Сообщение"})).toBe(field);expect((field as HTMLTextAreaElement).value).toBe("Unsaved draft");
});

it("a supplied completion cannot hide Stop or turn a running answer into a terminal state", async () => {
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 const {rerender}=render(<AgentChat api="/api/chat" chatId="c1"/>);await screen.findByRole("heading",{name:"С чего начнём?"});
 const field=screen.getByRole("textbox",{name:"Сообщение"});fireEvent.change(field,{target:{value:"Question"}});fireEvent.keyDown(field,{key:"Enter"});
 await waitFor(()=>expect(server.streams).toHaveLength(1));
 rerender(<AgentChat api="/api/chat" chatId="c1" completion={<CompletionCard title="Premature app result"/>}/>);
 expect(screen.getByRole("button",{name:"Остановить"})).toBeTruthy();expect(screen.queryByRole("region",{name:"Premature app result"})).toBeNull();
 await act(async()=>{server.streams[0]!.answer("Actual answer");});
 await screen.findByRole("region",{name:"Premature app result"});
 expect(within(screen.getByRole("log")).getByText("Actual answer")).toBeTruthy();
});


it("reserves a measured classic scrollbar gutter without clipping composer menus", async () => {
 vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(400);
 vi.spyOn(Element.prototype,"clientWidth","get").mockReturnValue(372);
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 const {container}=render(<AgentChat api="/api/chat" chatId="c1" header={{title:"Classic scrollbar"}}/>);
 await screen.findByRole("heading",{name:"Classic scrollbar"});
 await waitFor(()=>expect((container.querySelector('.oduvanchik-thread-root') as HTMLElement).style.getPropertyValue('--oduvanchik-scrollbar-gutter')).toBe('14px'));
});


it("explicit Tandem renders the optional parts in its own layout and restores its composer", async () => {
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 const {rerender,container}=render(<AgentChat api="/api/chat" chatId="c1" skin={tandemSkin} header={{title:"Explicit Tandem",headingLevel:2}} completion={<section aria-label="Custom result">Result</section>}/>);
 await screen.findByRole("region",{name:"Custom result"});
 expect(screen.getByRole("heading",{name:"Explicit Tandem",level:2})).toBeTruthy();
 expect(container.querySelector('.oduvanchik-thread-root')).toBeNull();
 expect(screen.queryByRole("textbox",{name:"Сообщение"})).toBeNull();
 rerender(<AgentChat api="/api/chat" chatId="c1" skin={tandemSkin} completion={false}/>);
 expect(screen.getByRole("textbox",{name:"Сообщение"})).toBeTruthy();
});

it("keeps active dictation and its Stop reachable while application completion is pending", async () => {
 const server=fakeChatServer();vi.stubGlobal("fetch",server.fetch);
 let listener!: import("@ykurilov/agent-chat-react").VoiceListener;
 const voice: import("@ykurilov/agent-chat-react").VoiceInput={start(next){listener=next;return{stop:()=>listener.onEnd(),cancel:vi.fn()};}};
 const {rerender}=render(<AgentChat api="/api/chat" chatId="c1" voice={voice}/>);
 await screen.findByRole("heading",{name:"С чего начнём?"});
 fireEvent.click(screen.getByRole("button",{name:"Диктовать"}));await act(async()=>listener.onConnected());
 rerender(<AgentChat api="/api/chat" chatId="c1" voice={voice} completion={<CompletionCard title="Pending voice result"/>}/>);
 expect(screen.queryByRole("region",{name:"Pending voice result"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Остановить диктовку"}));
 await screen.findByRole("region",{name:"Pending voice result"});
});

it("synchronizes an initially positioned scroll root on measurement without a scroll event", async () => {
 let measured!: ResizeObserverCallback;
 vi.stubGlobal("ResizeObserver",class { constructor(callback:ResizeObserverCallback){measured=callback;} observe(){} disconnect(){} });
 const {Layout}= (await import("../src/index")).oduvanchikSkin;
 function Positioned(){const ref=useRef<HTMLDivElement>(null);return <Layout header={{title:"Initial position"}} feed={<p>History</p>} composer={<div/>} scrollRef={ref} announcement=""/>;}
 const {container}=render(<Positioned/>);
 const scroll=container.querySelector(".oduvanchik-thread-scroll")!;
 Object.defineProperty(scroll,"scrollTop",{configurable:true,value:40});
 act(()=>measured([],{} as ResizeObserver));
 expect(container.querySelector(".yk-chat-header--scrolled")).not.toBeNull();
});
