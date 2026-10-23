import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import { Button, ChatProgress, CompletionCard } from "@ykurilov/ds-react";
import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./oduvanchik-chat-parts.css";
const params=new URLSearchParams(location.search);
document.documentElement.dataset.theme=params.get("theme")??"light";
// Application fixtures only. None of these words or business states belongs to the skin.
const examples={
 shop:{title:"Помощник магазина",prompt:"Напишите сообщение",user:"Нужен подарок папе, бюджет до 5000 ₽",answer:"Оформил: термокружка, 4 290 ₽, доставка курьером в пятницу с 10 до 14. Открытку можно добавить позже.",result:"Заказ оформлен",description:"Курьер позвонит за час до доставки.",items:["Термокружка с подогревом","Оплата картой","Доставка в пятницу, 10–14","Открытка"],action:"Изменить заказ",note:"Номер заказа 48 213"},
 form:{title:"Анкета участника",prompt:"Ответьте текстом или голосом",user:"Запустить первый поток курса и набрать 30 человек",answer:"Записал цель. Последний вопрос про удобное время созвонов можно пропустить и ответить позже.",result:"Анкета заполнена",description:"Ответы сохранены. Куратор напишет вам в течение дня.",items:["Контакты","Опыт","Цель на три месяца","Удобное время созвонов"],action:"Дополнить ответы",note:"Можно вернуться в любой момент"},
 task:{title:"Отчёт по продажам",prompt:"Что ещё сделать?",user:"Собери отчёт по продажам за сентябрь",answer:"Собрал данные из трёх источников. Выручка за сентябрь — **1,84 млн ₽**, на 12% больше августа.\n\nДобавил сравнение с прошлым годом. Таблица и графики готовы.",result:"Отчёт готов",description:"Файл сохранён в папке «Отчёты».",items:["Выручка и заказы","Сравнение с августом","Сравнение с прошлым годом","Разбивка по менеджерам"],action:"Открыть отчёт",note:"sales-2026-09.xlsx"},
};
const {Layout,UserMessage,AgentMessage,AgentText,Composer}=oduvanchikSkin;
function Gallery(){
 const[example,setExample]=useState<keyof typeof examples>((params.get("example")??"") in examples?params.get("example") as keyof typeof examples:"shop");
 const[state,setState]=useState(params.get("state")==="dialog"?"dialog":"done");const[value,setValue]=useState("");const[recording,setRecording]=useState(false);const scrollRef=useRef<HTMLDivElement>(null);const root=useRef<HTMLDivElement>(null);const ex=examples[example];const done=state==="done",busy=state==="working";
 const resume=()=>{setState("dialog");requestAnimationFrame(()=>root.current?.querySelector('textarea')?.focus());};
 const completion=done?<CompletionCard title={ex.result} description={ex.description} items={ex.items.map((label,index)=>({id:String(index),label,status:index===ex.items.length-1?"later":"done",...(index===ex.items.length-1&&{statusLabel:"позже"})}))} action={<Button variant="secondary" icon={PencilSimpleIcon} onClick={resume}>{ex.action}</Button>} note={ex.note}/>:undefined;
 return <ChatLabelsProvider labels={{...russianLabels,composerPlaceholder:ex.prompt}}><div className="parts-gallery" ref={root}><nav aria-label="Примеры" className="parts-controls">{(Object.keys(examples) as (keyof typeof examples)[]).map(key=><button key={key} aria-pressed={example===key} onClick={()=>setExample(key)}>{examples[key].title}</button>)}<button onClick={()=>setState(done?"dialog":"done")}>{done?"Разговор":"Итог"}</button><button onClick={()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";}}>Тема</button></nav>
 <div className="parts-scene"><Layout header={{title:ex.title,aside:<ChatProgress label={done?"Готово":"Шаг 2 из 3"} value={done?3:2} max={3}/>}} scrollRef={scrollRef} announcement="" completion={completion} feed={<>{Array.from({length:6},(_,i)=><div key={i}><UserMessage text={ex.user}/><AgentMessage status={busy&&i===5?"streaming":"complete"} empty={false} onCopy={()=>void navigator.clipboard?.writeText(ex.answer)}><AgentText markdown={ex.answer} streaming={busy&&i===5}/></AgentMessage></div>)}</>} composer={<Composer value={value} onValueChange={setValue} canSubmit={!!value.trim()} busy={busy} onSubmit={()=>{setValue("");setState("working");}} onStop={()=>setState("dialog")} voice={{state:recording?"listening":"idle",onToggle:()=>setRecording(!recording)}}/>}/></div></div></ChatLabelsProvider>;
}
function RuntimeGallery(){
 const[done,setDone]=useState(false);const root=useRef<HTMLDivElement>(null);
 return <div className="parts-gallery" ref={root}><nav className="parts-controls"><span>Реальный AgentChat · тестовая история · без модели</span><button onClick={()=>setDone(!done)}>Показать / убрать итог</button></nav><div className="parts-scene"><AgentChat api="/chat-parts-fixture" chatId="history" initialDraft="Unsaved application draft" header={{title:"Virtual history",aside:<ChatProgress label="Application progress" value={2} max={3}/>}} completion={done?<CompletionCard title="Application result" items={[{id:"one",label:"Application item",status:"done"}]} action={<Button onClick={()=>{setDone(false);requestAnimationFrame(()=>root.current?.querySelector('textarea')?.focus());}}>Continue</Button>}/>:undefined}/></div></div>;
}
createRoot(document.getElementById("root")!).render(params.get("runtime")==="1"?<RuntimeGallery/>:<Gallery/>);
