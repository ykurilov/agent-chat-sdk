// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { OduvanchikAgentPanel } from '../src/agent-panel';
import { TandemAgentPanel } from '../../tandem/src/agent-panel';

afterEach(cleanup);
for (const [name, Panel] of [['Oduvanchik',OduvanchikAgentPanel],['Tandem',TandemAgentPanel]] as const) {
 describe(`${name} explicit focus request`,()=> {
  it('repeats in the open panel and waits for its composer to mount',()=> {
   const props: ComponentProps<typeof OduvanchikAgentPanel>={open:true,focusRequest:1,mode:'overlay',width:420,title:'Chat',listOpen:false,onListOpenChange:vi.fn(),onClose:vi.fn(),onEscape:vi.fn(),list:null,children:null};
   const view=render(<Panel {...props}/>);
   view.rerender(<Panel {...props}><textarea aria-label="composer"/></Panel>);
   const input=view.getByLabelText('composer') as HTMLTextAreaElement;
   expect(document.activeElement).toBe(input);
   input.blur();
   view.rerender(<Panel {...props} focusRequest={2}><textarea aria-label="composer"/></Panel>);
   expect(document.activeElement).toBe(input);
   input.blur();
   view.rerender(<Panel {...props} focusRequest={3} listOpen><textarea aria-label="composer"/></Panel>);
   expect(document.activeElement).not.toBe(input);
   view.rerender(<Panel {...props} focusRequest={3}><textarea aria-label="composer"/></Panel>);
   expect(document.activeElement).toBe(input);
  });
 });
}
