import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

export function buttonClass(input: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const variant = input.variant ?? "primary";
  const size = input.size ?? "md";
  return classes(
    "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "min-h-9 px-3 py-2 text-xs" : "min-h-11 px-4 py-2.5 text-sm",
    variant === "primary" && "primary-button",
    variant === "secondary" && "secondary-button",
    variant === "danger" && "danger-button",
    variant === "ghost" && "border border-transparent bg-transparent text-[var(--text-primary)] hover:bg-[var(--surface-soft)]",
    input.className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classes("soft-card", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={classes("form-control", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={classes("form-control", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={classes("form-control resize-y", className)} {...props} />;
}

const badgeTone: Record<"neutral" | "success" | "warning" | "danger", string> = {
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTone }) {
  return <span className={classes("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold", badgeTone[tone], className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return <Card className="p-8 text-center">
    <h2 className="text-lg font-extrabold">{title}</h2>
    <p className="mx-auto mt-2 max-w-xl text-sm leading-7 text-[var(--text-secondary)]">{description}</p>
    {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
  </Card>;
}
