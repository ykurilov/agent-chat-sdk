import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { russianOduvanchikTextLabels } from "./text-labels";
import type { OduvanchikTextLabels } from "./text-labels";
export { russianOduvanchikTextLabels, englishOduvanchikTextLabels } from "./text-labels";
export type { OduvanchikTextLabels } from "./text-labels";
import { withoutExternalImages } from "./external-images";

/** Saved text only: works in React Server Components, without chat context or client hooks.
 * Diagrams/demos stay code, code blocks have no interactive copy button. The full skin entry is unchanged.
 */
export interface OduvanchikAgentTextProps {
  markdown: string;
  /** Accepted for migration from the full skin; saved text is rendered synchronously. */
  streaming?: boolean;
  className?: string;
  labels?: Partial<OduvanchikTextLabels>;
}

export function OduvanchikAgentText({ markdown, className, labels: overrides }: OduvanchikAgentTextProps) {
  const { externalImageLabel, tableLabel, taskDoneLabel, taskOpenLabel } = { ...russianOduvanchikTextLabels, ...overrides };
  const components: Components = {
    a: ({ node: _, href, ...props }) => <a {...props} {...(href?.trim() ? { href } : {})} {...(/^https?:\/\//.test(href ?? "") ? { target: "_blank", rel: "noopener noreferrer" } : {})} />,
    table: ({ node: _, ...props }) => <div className="tandem-table-wrap" tabIndex={0} role="region" aria-label={tableLabel}><table {...props} /></div>,
    pre: ({ node: _, ...props }) => <div className="tandem-code"><pre {...props} /></div>,
    input: ({ node: _, ...props }) => <input {...props} {...(props.type === "checkbox" ? { "aria-label": props.checked ? taskDoneLabel : taskOpenLabel } : {})} />,
    img: ({ node: _, alt, ...props }) => <img {...props} alt={alt ?? ""} loading="lazy" />,
  };
  return <div className={["oduvanchik-message-text", "tandem-markdown", className].filter(Boolean).join(" ")}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{withoutExternalImages(markdown, externalImageLabel)}</ReactMarkdown></div>;
}
