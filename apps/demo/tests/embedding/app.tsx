import React, { useState, useRef } from 'react';
import { ChatLabelsProvider, russianLabels } from '@ykurilov/agent-chat-react';
import { createRoot } from 'react-dom/client';
import { AgentPanelProvider, AgentPanel, useAgentPanel } from '@ykurilov/agent-chat-react/panel';
import { oduvanchikSkin } from '@ykurilov/agent-chat-skin-oduvanchik';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '../../../../skins/oduvanchik/src/primitives/dialog';
import { Menu, MenuTrigger, MenuContent, MenuItem } from '../../../../skins/oduvanchik/src/primitives/menu';

function Controls() {
  const panel = useAgentPanel();
  return <><button onClick={panel.focusComposer}>Edit with AI</button><button onClick={panel.showChat}>Show chat</button></>;
}
function App() {
  const [styles, setStyles] = useState(false);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const Launcher=oduvanchikSkin.AgentPanelLauncher;
  const launcherOnly=new URLSearchParams(window.location.search).has('launcher');
  return <><button onClick={async () => { await import('../../../../skins/oduvanchik/dist/embedded.css'); setStyles(true); }}>Load panel styles</button><output>{styles ? 'Styles ready' : 'No panel styles'}</output>
    {launcherOnly ? <ChatLabelsProvider labels={russianLabels}><Launcher open={false} busy={false} onToggle={()=>{}} buttonRef={buttonRef}/></ChatLabelsProvider> : <AgentPanelProvider api="/api/chat" userKey="fixture"><Controls/><AgentPanel skin={oduvanchikSkin}/></AgentPanelProvider>}
    <section className="oduvanchik-chat" style={{maxWidth:300}}><Menu><MenuTrigger>Portal menu</MenuTrigger><MenuContent><MenuItem>Portal item</MenuItem></MenuContent></Menu>
    <Dialog><DialogTrigger>Portal dialog</DialogTrigger><DialogContent><DialogTitle>Test dialog</DialogTitle><p>Inside portal</p></DialogContent></Dialog></section></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
