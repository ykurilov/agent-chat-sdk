/** Цвета схемы: их отдаёт скин (`ChatSkin.diagramColors`), по ним рисовальщик красит схему. */
export interface DiagramColors {
  background: string;
  text: string;
  line: string;
  node: string;
  accent: string;
  dark: boolean;
}

/** Рисовальщик схем для свойства `diagrams` экрана чата. */
export interface DiagramsClient {
  render(source: string, colors: DiagramColors): Promise<{ svg: string } | { error: string }>;
}
