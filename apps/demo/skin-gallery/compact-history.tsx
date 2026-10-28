import { AgentChat, ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
import { TooltipProvider } from "@tandem/ui";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "./compact-history.css";
const params=new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark",params.get("theme")==="dark");
document.documentElement.dataset.theme=params.get("theme")??"light";
function Fixture(){
 const [state,setState]=useState({kind:"waiting",shown:0,total:0});
 return <TooltipProvider><ChatLabelsProvider labels={russianLabels}>
   <output data-history-kind={state.kind} data-shown={state.shown} data-total={state.total}>History fixture</output>
   <div style={{height:"calc(100dvh - 28px)"}}><AgentChat api="/compact-fixture" chatId="c1" history="compact"
     skin={params.get("skin")==="tandem"?tandemSkin:oduvanchikSkin} workView={params.get("simple")==="1"?"simple":"detailed"}
     onFeedChange={({messages,change})=>setState({kind:change.kind,shown:messages.length,total:change.view?.totals.assistantAnswers??0})}/></div>
 </ChatLabelsProvider></TooltipProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
