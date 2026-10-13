import { Component } from "react";
import type { ReactNode } from "react";

/**
 * Граница вокруг своего виджета страницы: упавший компонент (например, на негодном входе модели) не роняет ленту.
 * После падения виджет показывается запасным видом скина.
 */
export class CustomWidgetGuard extends Component<{ onCrash: () => void; children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(): void {
    this.props.onCrash();
  }

  override render(): ReactNode {
    return this.state.crashed ? null : this.props.children;
  }
}
