import { ApiError } from "@/lib/http/api";
import { integrationFetch } from "./http";

const GITHUB_API = "https://api.github.com";

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.includes("..")) {
    throw new ApiError(400, "GITHUB_PATH_INVALID", "مسار GitHub غير صالح.");
  }
  const response = await integrationFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 ? 422 : response.status === 403 ? 403 : 502,
      response.status === 401 ? "GITHUB_TOKEN_INVALID" : "GITHUB_API_ERROR",
      response.status === 401 ? "توكن GitHub غير صالح." : "رفض GitHub طلب التكامل.",
      { githubStatus: response.status },
    );
  }
  return payload as T;
}

export type GitHubIdentity = { login: string; id: number; name?: string | null };
export type GitHubRepository = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  updated_at: string;
};

export function verifyGitHubToken(token: string) {
  return githubRequest<GitHubIdentity>(token, "/user");
}

export function listGitHubRepositories(token: string, limit = 20) {
  return githubRequest<GitHubRepository[]>(
    token,
    `/user/repos?sort=updated&direction=desc&per_page=${Math.min(Math.max(limit, 1), 50)}&affiliation=owner,collaborator,organization_member`,
  );
}

export function readGitHubFile(token: string, owner: string, repo: string, path: string, ref?: string) {
  const safe = [owner, repo].every((value) => /^[A-Za-z0-9_.-]+$/.test(value));
  if (!safe || path.startsWith("/") || path.includes("..")) {
    throw new ApiError(400, "GITHUB_RESOURCE_INVALID", "المستودع أو مسار الملف غير صالح.");
  }
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return githubRequest<{ name: string; path: string; sha: string; content?: string; encoding?: string }>(
    token,
    `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${suffix}`,
  );
}
