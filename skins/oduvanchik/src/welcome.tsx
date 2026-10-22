import { ArrowUpRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Sphere } from "@ykurilov/ds-react";

/** Application-owned copy and suggestions: this is an optional empty-chat composition, outside ChatSkin. */
export function OduvanchikWelcome({ title, description, suggestions, onPick }: {
  title: string;
  description?: ReactNode;
  suggestions: Array<{ label: string; category?: string }>;
  onPick: (text: string) => void;
}) {
  return <section className="oduvanchik-welcome">
    <div className="oduvanchik-welcome-intro"><Sphere size={96} /><h1>{title}</h1>{description && <p>{description}</p>}</div>
    <div className="oduvanchik-welcome-suggestions">{suggestions.map((item) =>
      <button type="button" key={item.label} onClick={() => onPick(item.label)}>
        {item.category && <span className="oduvanchik-label">{item.category}</span>}
        <span>{item.label}</span><ArrowUpRightIcon size={16} aria-hidden />
      </button>)}</div>
  </section>;
}
