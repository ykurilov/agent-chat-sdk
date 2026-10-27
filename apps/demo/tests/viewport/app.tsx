import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as ChatUI from '@ykurilov/agent-chat-react';
import { oduvanchikSkin } from '@ykurilov/agent-chat-skin-oduvanchik';
import { tandemSkin } from '@ykurilov/agent-chat-skin-tandem';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '../../../../skins/oduvanchik/src/primitives/dialog';
import '../../src/oduvanchik.css';
import './fixture.css';
const selected = new URLSearchParams(location.search);
const skin = selected.get('skin') === 'tandem' ? tandemSkin : oduvanchikSkin;
// The same fixture can run against a baseline SDK which has no new export.
const Shell = (ChatUI as typeof ChatUI & { ChatAppViewport?: React.ComponentType<ChatUI.ChatAppViewportProps> }).ChatAppViewport;
function NativeMetrics() {
  const [status,setStatus]=useState('Viewport waiting');
  useEffect(()=>{
    let frame=0,lastGeometry='';
    void fetch('/probe',{method:'POST',body:JSON.stringify({event:'mounted',time:Date.now()})}).catch(()=>{});
    const trace=(event:Event)=>{
      const field=document.querySelector('textarea');const box=field?.getBoundingClientRect();
      const target=event.target as HTMLElement;
      const touch=event instanceof TouchEvent?event.changedTouches[0]:null;
      const point=touch||((event instanceof MouseEvent)?event:null);
      void fetch('/probe',{method:'POST',body:JSON.stringify({time:Date.now(),event:event.type,target:target.tagName,classes:target.className,point:point&&[point.clientX,point.clientY],active:document.activeElement?.tagName,field:box&&[box.x,box.y,box.width,box.height],disabled:field?.disabled,viewport:[visualViewport?.height,visualViewport?.offsetTop],inner:innerHeight})}).catch(()=>{});
    };
    const events=['touchstart','pointerdown','click','focusin','focusout'];events.forEach(name=>document.addEventListener(name,trace,true));
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const v=window.visualViewport;const shell=document.querySelector('[data-agent-chat-app-viewport]');
      const composer=document.querySelector('[data-agent-chat-composer]');
      if(!shell||!composer||!v)return;
      const bottom=(Number.isFinite(v.pageTop)?v.pageTop-scrollY:v.offsetTop)+v.height,box=composer.getBoundingClientRect();
      const keyboard=(shell as HTMLElement).style.getPropertyValue('--agent-chat-safe-area-bottom').trim()==='0px';
      const aligned=Math.abs(box.bottom-bottom)<=2;
      const signature=JSON.stringify({event:'geometry',viewport:[v.height,v.offsetTop,v.pageTop],scrollY,innerHeight,shellTop:shell.getBoundingClientRect().top,cssTop:(shell as HTMLElement).style.top,field:document.querySelector('textarea')?.getBoundingClientRect().toJSON(),keyboard,aligned});
      if(signature!==lastGeometry){lastGeometry=signature;void fetch('/probe',{method:'POST',body:signature}).catch(()=>{});}
      setStatus(`Viewport ${aligned?'ready':'gap'} ${keyboard?'keyboard':'closed'} ${Math.round(box.bottom)} ${Math.round(bottom)} active:${document.activeElement?.tagName} blur:${document.body.dataset.blurCount||'0'} inner:${innerHeight} scale:${v.scale} boot:${Math.round(performance.timeOrigin)}`);
    });};
    const timer=setInterval(measure,150);measure();
    return()=>{clearInterval(timer);cancelAnimationFrame(frame);events.forEach(name=>document.removeEventListener(name,trace,true));};
  },[]);
  return <span data-testid="native-metrics" style={{flex:'0 0 12px',height:12,fontSize:8,lineHeight:'12px',whiteSpace:'nowrap',overflow:'hidden'}}>{status}</span>;
}
function App() {
  const [mounted, setMounted] = useState(true);
  const header=<nav data-testid="navigation"><span>Application</span><button onClick={()=>{document.body.dataset.blurCount=String(Number(document.body.dataset.blurCount||0)+1);document.querySelectorAll('textarea,input').forEach(n=>(n as HTMLElement).blur());}}>Blur</button><button onClick={()=>setMounted(!mounted)}>Route</button>
    <Dialog><DialogTrigger>Dialog</DialogTrigger><DialogContent><DialogTitle>Dialog title</DialogTitle><input aria-label="Dialog input"/></DialogContent></Dialog></nav>;
  const chat=<>{selected.has('native')&&<NativeMetrics/>}<ChatUI.ChatWorkspace api="/api/chat" skin={skin}/></>;
  if (!mounted) return <button onClick={()=>setMounted(true)}>Mount app</button>;
  if (!Shell || selected.has('legacy')) return <div data-agent-chat-app-viewport="" style={{height:'100dvh',display:'flex',flexDirection:'column'}}>{header}<main style={{minHeight:0,flex:1,overflow:'auto'}}>{chat}</main></div>;
  return <Shell header={header}>{chat}</Shell>;
}
createRoot(document.getElementById('root')!).render(<App/>);
