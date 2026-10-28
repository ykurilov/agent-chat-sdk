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
function DensityDemo() {
  const params = new URLSearchParams(location.search);
  const Panel = oduvanchikSkin.AgentPanel;
  const Composer = oduvanchikSkin.Composer;
  const [draft, setDraft] = useState('Текст для проверки размера поля');
  return <ChatLabelsProvider labels={russianLabels}><div data-density-host style={{ '--yk-studio-body-size': '14px' } as React.CSSProperties}>
    <Panel open mode={params.get('mode') === 'push' ? 'push' : 'overlay'} width={420} title="Агент приложения" listOpen={false} onListOpenChange={()=>{}} onClose={()=>{}} onEscape={()=>{}} list={null}>
      <div className="flex h-full min-h-0 flex-col"><div className="oduvanchik-thread flex-1"><p>Текст ленты в панели приложения</p></div><Composer value={draft} onValueChange={setDraft} onSubmit={()=>{}} canSubmit busy={false} onStop={()=>{}} /></div>
    </Panel>
    <section data-fullscreen-control className="oduvanchik-chat" style={{width:700}}><div className="oduvanchik-thread"><p>Полноэкранная лента</p></div><Composer value="Полноэкранное поле" onValueChange={()=>{}} onSubmit={()=>{}} canSubmit busy={false} onStop={()=>{}} /></section>
  </div></ChatLabelsProvider>;
}
function App() {
  const [styles, setStyles] = useState(false);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const Launcher=oduvanchikSkin.AgentPanelLauncher;
  const launcherOnly=new URLSearchParams(window.location.search).has('launcher');
  return <><button onClick={async () => { await import('../../../../skins/oduvanchik/dist/embedded.css'); setStyles(true); }}>Load panel styles</button><output>{styles ? 'Styles ready' : 'No panel styles'}</output>
    {new URLSearchParams(location.search).has('density') ? <DensityDemo/> : launcherOnly ? <ChatLabelsProvider labels={russianLabels}><Launcher open={false} busy={false} onToggle={()=>{}} buttonRef={buttonRef}/></ChatLabelsProvider> : <AgentPanelProvider api="/api/chat" userKey="fixture"><Controls/><AgentPanel skin={oduvanchikSkin}/></AgentPanelProvider>}
    <section className="oduvanchik-chat" style={{maxWidth:300}}><Menu><MenuTrigger>Portal menu</MenuTrigger><MenuContent><MenuItem>Portal item</MenuItem></MenuContent></Menu>
    <Dialog><DialogTrigger>Portal dialog</DialogTrigger><DialogContent><DialogTitle>Test dialog</DialogTitle><p>Inside portal</p></DialogContent></Dialog></section></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
