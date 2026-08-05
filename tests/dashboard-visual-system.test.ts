import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dashboard visual system", () => {
  it("loads Alexandria globally after the base application styles", async () => {
    const layout = await readFile("src/app/layout.tsx", "utf8");
    const typography = await readFile("src/app/typography.css", "utf8");
    expect(layout).toContain('import "@fontsource-variable/alexandria"');
    expect(layout).toContain('import "./dashboard-polish.css"');
    expect(typography).toContain('font-family: "Alexandria Variable"');
    expect(typography).not.toContain("Noto Naskh Arabic");
  });

  it("uses calm blue and violet tokens instead of the previous teal-heavy palette", async () => {
    const css = await readFile("src/app/dashboard-polish.css", "utf8");
    expect(css).toContain("--primary: #4f46e5");
    expect(css).toContain("--accent: #2563eb");
    expect(css).toContain("--background: #f5f7fb");
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain("--background: #0f1522");
  });

  it("provides a compact responsive Telegram card and mobile actions", async () => {
    const css = await readFile("src/app/dashboard-polish.css", "utf8");
    const component = await readFile("src/components/central-telegram-manager.tsx", "utf8");
    expect(css).toContain(".telegram-link-card");
    expect(css).toContain("@media (max-width: 700px)");
    expect(css).toContain(".telegram-actions");
    expect(component).toContain("telegram-status-chip");
    expect(component).toContain("telegram-permissions");
  });
});
