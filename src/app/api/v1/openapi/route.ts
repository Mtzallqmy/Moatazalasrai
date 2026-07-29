import { NextResponse } from "next/server";

const operations = {
  "/api/v1/agents": { get: "List agents", post: "Create agent" },
  "/api/v1/conversations": { get: "List conversations or messages", post: "Create conversation" },
  "/api/v1/chat": { post: "Send a message with optional attachment IDs" },
  "/api/v1/files": { get: "List or download files", post: "Upload multipart file" },
  "/api/v1/runs": { get: "List runs", post: "Execute agent run" },
  "/api/v1/provider-credentials": { post: "Create provider credential" },
  "/api/v1/integrations": { get: "List integration health" },
  "/api/v1/github": { post: "List repositories or read a repository file" },
} as const;

export function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: {
      title: "Moataz Agent Platform API",
      version: "1.1.0",
      description: "Versioned JSON API for native Android, automation, and external clients.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "Platform API Key" },
      },
      schemas: {
        Success: {
          type: "object",
          required: ["success", "data", "meta"],
          properties: {
            success: { const: true },
            data: {},
            meta: {
              type: "object",
              properties: { requestId: { type: "string" } },
              required: ["requestId"],
            },
          },
        },
        Failure: {
          type: "object",
          required: ["success", "error"],
          properties: {
            success: { const: false },
            error: {
              type: "object",
              required: ["code", "message", "requestId"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                requestId: { type: "string" },
              },
            },
          },
        },
      },
    },
    paths: Object.fromEntries(Object.entries(operations).map(([path, methods]) => [
      path,
      Object.fromEntries(Object.entries(methods).map(([method, summary]) => [
        method,
        {
          summary,
          responses: {
            "200": { description: "Success" },
            "400": { description: "Validation error" },
            "401": { description: "Invalid API key" },
            "500": { description: "Internal error" },
          },
        },
      ])),
    ])),
  }, { headers: { "cache-control": "public, max-age=300" } });
}
