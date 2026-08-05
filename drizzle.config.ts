import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/db/schema.ts",
    "./src/db/channel-schema.ts",
    "./src/db/control-plane-schema.ts",
    "./src/db/mcp-catalog-schema.ts",
    "./src/db/provider-health-schema.ts",
    "./src/db/site-connections-schema.ts",
    "./src/db/site-oauth-schema.ts",
    "./src/db/browser-login-schema.ts",
    "./src/db/sandbox-schema.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL as string,
  },
});
