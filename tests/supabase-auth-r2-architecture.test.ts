import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase Auth and R2 architecture", () => {
  it("keeps authorization in Railway and links only the external subject", async () => {
    const [migration, identity] = await Promise.all([
      readFile("drizzle/0052_supabase_auth_identity.sql", "utf8"),
      readFile("src/lib/auth/supabase-identity.ts", "utf8"),
    ]);
    expect(migration).toContain('"supabase_user_id"');
    expect(migration).not.toMatch(/organizations|custom_permissions|member_role/i);
    expect(identity).toContain("organizationMembers");
    expect(identity).toContain("publicRegistrationEnabled");
    expect(identity).not.toContain("user_metadata?.role");
  });

  it("uses direct signed R2 upload and defers file processing to the worker", async () => {
    const [route, queue, task] = await Promise.all([
      readFile("src/app/api/dashboard/files/presigned/route.ts", "utf8"),
      readFile("src/worker/queue.ts", "utf8"),
      readFile("src/worker/tasks/attachment-process.ts", "utf8"),
    ]);
    expect(route).toContain("createSignedUploadUrl");
    expect(route).toContain("enqueueAttachmentProcess");
    expect(queue).toContain('addJob("attachment-process"');
    expect(task).toContain("processStoredAttachment");
  });
});
