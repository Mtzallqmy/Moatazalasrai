/**
 * Small, framework-free utilities kept separate from React/Next so they
 * are trivially unit-testable (see tests/utils.test.ts).
 */

export function isNonEmptyTitle(title: unknown): title is string {
  return typeof title === "string" && title.trim().length > 0;
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ar", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}
