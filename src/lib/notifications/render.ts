const VARIABLE = /{{\s*([A-Za-z0-9_.-]{1,80})\s*}}/g;

export function templateVariables(template: string) {
  return [...new Set([...template.matchAll(VARIABLE)].map((match) => match[1]))];
}

function readPath(values: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
}

export function renderNotificationTemplate(
  template: string,
  values: Record<string, unknown>,
  allowedVariables?: readonly string[],
) {
  const allowed = allowedVariables ? new Set(allowedVariables) : null;
  return template.replace(VARIABLE, (_match, variable: string) => {
    if (allowed && !allowed.has(variable)) throw new Error(`NOTIFICATION_VARIABLE_NOT_ALLOWED:${variable}`);
    const value = readPath(values, variable);
    if (value === undefined || value === null) throw new Error(`NOTIFICATION_VARIABLE_MISSING:${variable}`);
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  });
}
