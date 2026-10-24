/** SDK flow prop adapters. All control rendering belongs to the published design system. */
import { Button as DsButton, Chip, Banner, TextField, Textarea as DsTextarea, Select as DsSelect } from "@ykurilov/ds-react";
import type { ButtonAsButtonProps, ChipTone, TextFieldProps, TextareaProps, SelectProps } from "@ykurilov/ds-react";
import { createContext, useContext, forwardRef, type HTMLAttributes, type ReactNode } from "react";

export { Switch } from "@ykurilov/ds-react";
export const FieldLabel = createContext<string | undefined>(undefined);
export function cn(...parts: Array<string | false | null | undefined>) { return parts.filter(Boolean).join(" "); }

type ButtonProps = Omit<ButtonAsButtonProps, "variant" | "children"> & { children: ReactNode; variant?: ButtonAsButtonProps["variant"] | "warm" };
export function Button({ variant, children, ...props }: ButtonProps) { return <DsButton {...props} variant={variant === "warm" ? "secondary" : variant}>{children}</DsButton>; }
export function Badge({ variant, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: string }) {
  const tone: ChipTone = variant === "success" ? "success" : variant === "danger" ? "danger" : "neutral";
  return <Chip {...props} tone={tone} />;
}
export function Alert({ variant, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { variant?: string; title: ReactNode }) {
  return <Banner {...props} tone={variant === "danger" ? "danger" : "neutral"} />;
}
export const Input = forwardRef<HTMLInputElement, TextFieldProps>(function Input(props, ref) {
  const label = useContext(FieldLabel);
  return <TextField ref={ref} size="sm" aria-label={label} {...props} error={props.error ?? (props["aria-invalid"] === true || props["aria-invalid"] === "true")} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(props, ref) {
  const label = useContext(FieldLabel);
  return <DsTextarea ref={ref} aria-label={label} {...props} error={props.error ?? (props["aria-invalid"] === true || props["aria-invalid"] === "true")} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(props, ref) {
  const label = useContext(FieldLabel);
  return <DsSelect ref={ref} size="sm" aria-label={label} {...props} error={props.error ?? (props["aria-invalid"] === true || props["aria-invalid"] === "true")} />;
});
