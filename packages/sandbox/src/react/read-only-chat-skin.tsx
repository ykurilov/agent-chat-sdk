import type { ChatSkin, ToolApprovalView, WidgetView } from "@ykurilov/agent-chat-react";

const readOnlySkins = new WeakMap<ChatSkin, ChatSkin>();

/**
 * Скин чата только на чтение (чат человека в песочнице): без поля ввода, без правки, повтора, нового ответа,
 * переключения веток и кнопок-подсказок. Решать за человека тоже нельзя: ждущие подтверждения без кнопок, задачи без
 * «Отменить», виджеты не нажимаются, свой виджет приложения — запасным видом. Рисуют те же компоненты скина. Обёртка
 * одна на скин: компоненты не пересоздаются при перерисовке.
 */
export function readOnlyChatSkin(skin: ChatSkin): ChatSkin {
  const known = readOnlySkins.get(skin);
  if (known) return known;
  const { SuggestedReplies: _suggestedReplies, ...rest } = skin;
  const { Widget, HelperCallRow, AgentNoticeView, TaskCard } = skin;
  const wrapped: ChatSkin = {
    ...rest,
    Layout: ({ composer: _composer, ...props }) => <skin.Layout {...props} composer={null} />,
    UserMessage: ({ onEdit: _onEdit, ...props }) => <skin.UserMessage {...props} />,
    AgentMessage: ({ onRetry: _onRetry, onRegenerate: _onRegenerate, onEdit: _onEdit, ...props }) => <skin.AgentMessage {...props} />,
    BranchSwitcher: ({ onPrevious: _onPrevious, onNext: _onNext, ...props }) => <skin.BranchSwitcher {...props} />,
    ToolCallRow: ({ approval, ...props }) => <skin.ToolCallRow {...props} {...decided(approval)} />,
    ...(HelperCallRow && { HelperCallRow: ({ approval, ...props }) => <HelperCallRow {...props} {...decided(approval)} /> }),
    ...(AgentNoticeView && { AgentNoticeView: ({ approval, ...props }) => <AgentNoticeView {...props} {...decided(approval)} /> }),
    ...(TaskCard && { TaskCard: ({ onCancel: _onCancel, ...props }) => <TaskCard {...props} /> }),
    ...(Widget && { Widget: (props) => <Widget {...inactiveWidget(props)} /> }),
  };
  readOnlySkins.set(skin, wrapped);
  return wrapped;
}

/** Итог решения остаётся пометкой; ждущее решение — без кнопок. */
function decided(approval: ToolApprovalView | undefined): { approval?: ToolApprovalView } {
  return approval && approval.state !== "requested" ? { approval } : {};
}

function inactiveWidget(view: WidgetView): WidgetView {
  const base = { ...view, active: false };
  switch (base.kind) {
    case "choice": {
      const { onChoose: _onChoose, ...widget } = base;
      return widget;
    }
    case "multi_choice":
    case "form": {
      const { onSubmit: _onSubmit, ...widget } = base;
      return widget;
    }
    case "rating": {
      const { onRate: _onRate, ...widget } = base;
      return widget;
    }
    case "custom": {
      const { content: _content, ...widget } = base;
      return widget;
    }
  }
}
