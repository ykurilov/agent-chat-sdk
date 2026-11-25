// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ChatLabelsProvider, russianLabels } from '@ykurilov/agent-chat-react';
import { OduvanchikAgentPanel } from '../src/agent-panel';
import { TandemAgentPanel } from '../../tandem/src/agent-panel';

/** Экран телефона (≤ 640 px) или компьютера: медиазапрос панели отвечает `narrow`. */
function screenWidth(narrow: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: narrow && query.includes('max-width: 640px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props: ComponentProps<typeof OduvanchikAgentPanel> = { open: true, mode: 'overlay', width: 420, title: 'Урок', listOpen: false, onListOpenChange: vi.fn(), onClose: vi.fn(), onEscape: vi.fn(), list: null, children: null };

for (const [name, Panel] of [['Oduvanchik', OduvanchikAgentPanel], ['Tandem', TandemAgentPanel]] as const) {
  describe(`${name}: подпись кнопки закрытия`, () => {
    it('на телефоне у кнопки видимая подпись из словаря, и она же — имя кнопки', () => {
      screenWidth(true);
      render(<Panel {...props} />);
      const close = screen.getByRole('button', { name: russianLabels.agentPanelCloseText });
      expect(close.textContent).toContain(russianLabels.agentPanelCloseText);
    });

    it('приложение задаёт свою подпись («Назад к уроку»)', () => {
      screenWidth(true);
      render(
        <ChatLabelsProvider labels={{ ...russianLabels, agentPanelCloseText: 'Назад к уроку' }}>
          <Panel {...props} />
        </ChatLabelsProvider>,
      );
      expect(screen.getByRole('button', { name: 'Назад к уроку' }).textContent).toContain('Назад к уроку');
    });

    it('на широком экране — только значок с прежним именем', () => {
      screenWidth(false);
      render(<Panel {...props} />);
      const close = screen.getByRole('button', { name: russianLabels.agentPanelClose });
      expect(close.textContent).toBe('');
    });
  });
}
