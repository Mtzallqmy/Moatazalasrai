import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

export function buttonClass(input: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const variant = input.variant ?? "primary";
  const size = input.size ?? "md";
  return cn(
    "ui-button",
    size === "sm" && "ui-button-sm",
    size === "md" && "ui-button-md",
    size === "lg" && "ui-button-lg",
    variant === "primary" && "primary-button",
    variant === "secondary" && "secondary-button",
    variant === "danger" && "danger-button",
    variant === "ghost" && "ui-button-ghost",
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

export function IconButton({ label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" aria-label={label} title={label} className={cn("icon-button", className)} {...props} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("soft-card", className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("form-control", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("form-control", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("form-control resize-y", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn("ui-field", className)} {...props}>
      <span className="ui-field-label">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      {children}
      {error ? <span className="ui-field-error" role="alert">{error}</span> : hint ? <span className="ui-field-hint">{hint}</span> : null}
    </label>
  );
}

const badgeTone: Record<"neutral" | "success" | "warning" | "danger" | "info", string> = {
  neutral: "status-neutral",
  success: "status-success",
  warning: "status-warning",
  danger: "status-error",
  info: "status-info",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTone }) {
  return <span className={cn("status-badge", badgeTone[tone], className)} {...props} />;
}

const statusTone: Record<string, keyof typeof badgeTone> = {
  available: "success",
  healthy: "success",
  verified: "success",
  connected: "success",
  completed: "success",
  published: "success",
  ready: "success",
  running: "info",
  processing: "info",
  streaming: "info",
  queued: "neutral",
  draft: "neutral",
  pending: "neutral",
  archived: "neutral",
  degraded: "warning",
  rate_limited: "warning",
  waiting_approval: "warning",
  failed: "danger",
  disabled: "danger",
  unavailable: "danger",
  not_configured: "danger",
  unauthorized: "danger",
  cancelled: "danger",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  const tone = statusTone[status.toLowerCase()] ?? "neutral";
  return <Badge tone={tone} className={className}>{label ?? status}</Badge>;
}

export function Alert({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ui-alert", `ui-alert-${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      <div className="min-w-0">
        {title ? <strong>{title}</strong> : null}
        <div className="ui-alert-body">{children}</div>
      </div>
      {action ? <div className="ui-alert-action">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("ui-skeleton", className)} {...props} />;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return <Card className={cn("empty-state-card", className)}>
    {icon ? <div className="empty-state-icon" aria-hidden="true">{icon}</div> : null}
    <h2>{title}</h2>
    <p>{description}</p>
    {action ? <div className="empty-state-action">{action}</div> : null}
  </Card>;
}

export function PageSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("page-section", className)}>
      <header className="page-section-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action ? <div className="page-section-action">{action}</div> : null}
      </header>
      <div className="page-section-body">{children}</div>
    </section>
  );
}

export function SegmentedControl({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: Array<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.value}
          disabled={item.disabled}
          aria-pressed={value === item.value}
          className={value === item.value ? "segmented-control-active" : undefined}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
