/** Adapted from @ykurilov/tandem-ui 0.7.0 src/components/markdown.tsx (MIT).
 * Skin-owned renderer: Phosphor icons; upstream behaviour and accessible Radix primitives retained.
 * Keep this file independent of the upstream icon-bearing components. See TANDEM_NOTICES.md.
 */
import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { CheckIcon as Check, CopyIcon as Copy } from "@phosphor-icons/react"
import { cn } from "@tandem/ui"
import { useTandemLabels, type MarkdownLabels } from "@tandem/ui"
import { Button } from "@tandem/ui"

export type MarkdownProps = {
  /** Текст ответа в разметке Markdown. Недописанный текст во время печати тоже годится. */
  children: string
  className?: string
  /** Надписи на другом языке. Главнее общего TandemLabelsProvider. */
  labels?: Partial<MarkdownLabels>
}

/** Разметка в ответах агента: заголовки, списки, таблицы, код, цитаты, ссылки. Сырой HTML не выполняется. */
export function Markdown({ children, className, labels: overrides }: MarkdownProps) {
  const labels = useTandemLabels("markdown", overrides)
  const components = React.useMemo(() => markdownComponents(labels), [labels])
  return (
    <div className={cn("tandem-markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{children}</ReactMarkdown>
    </div>
  )
}

const markdownComponents = (labels: MarkdownLabels): Components => ({
  // Внешние ссылки открываются рядом, чтобы не терять переписку.
  a: ({ node: _node, href, ...props }) => {
    const external = href ? /^https?:\/\//.test(href) : false
    return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})} {...props} />
  },
  // Широкая таблица прокручивается внутри себя, а не растягивает пузырь.
  // Фокус с клавиатуры нужен, чтобы её можно было прокрутить стрелками.
  table: ({ node: _node, ...props }) => (
    <div className="tandem-table-wrap" tabIndex={0} role="region" aria-label={labels.table}>
      <table {...props} />
    </div>
  ),
  pre: ({ node: _node, children }) => {
    const code = React.isValidElement<{ children?: React.ReactNode }>(children) ? children.props.children : children
    return (
      <div className="tandem-code group/code">
        <pre>{children}</pre>
        <CopyCode labels={labels} text={String(code ?? "").replace(/\n$/, "")} />
      </div>
    )
  },
  // Галочка в списке дел только показывает состояние. Подпись нужна диктору: без неё он скажет просто «флажок».
  input: ({ node: _node, ...props }) =>
    props.type === "checkbox" ? <input {...props} aria-label={props.checked ? labels.taskDone : labels.taskOpen} /> : <input {...props} />,
  img: ({ node: _node, alt, ...props }) => <img alt={alt ?? ""} loading="lazy" {...props} />
})

function CopyCode({ labels, text }: { labels: MarkdownLabels; text: string }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<number | undefined>(undefined)
  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Браузер не дал доступ к буферу: кнопка просто остаётся как была.
    }
  }

  return (
    // Как карандаш у сообщений: тихо появляется при наведении, без мыши виден всегда.
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? labels.copied : labels.copyCode}
      onClick={copy}
      className={cn(
        "absolute right-1.5 top-1.5 size-7 rounded-[var(--radius-small)] bg-[var(--surface)] text-[var(--foreground-subtle)] opacity-0 transition-opacity duration-[var(--motion-fast)] focus-visible:opacity-100 group-hover/code:opacity-100 [@media(hover:none)]:opacity-70 [&_svg]:size-3.5",
        copied && "text-[var(--success-text)] opacity-100"
      )}
    >
      {copied ? <Check weight="regular" aria-hidden="true" /> : <Copy weight="regular" aria-hidden="true" />}
    </Button>
  )
}
