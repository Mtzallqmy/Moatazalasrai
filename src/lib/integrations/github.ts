import { ApiError } from "@/lib/http/api";
import { integrationFetch } from "./http";

const GITHUB_API = "https://api.github.com";
const GITHUB_NAME = /^[A-Za-z0-9_.-]+$/;

async function githubRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.includes("..")) {
    throw new ApiError(400, "GITHUB_PATH_INVALID", "مسار GitHub غير صالح.");
  }
  const response = await integrationFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const status = response.status === 401 ? 422 : response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
    const code = response.status === 401
      ? "GITHUB_TOKEN_INVALID"
      : response.status === 404
        ? "GITHUB_RESOURCE_NOT_FOUND"
        : "GITHUB_API_ERROR";
    const message = response.status === 401
      ? "توكن GitHub غير صالح."
      : response.status === 404
        ? "تعذر العثور على مورد GitHub المطلوب."
        : "رفض GitHub طلب التكامل.";
    throw new ApiError(status, code, message, { githubStatus: response.status });
  }
  return payload as T;
}

export type GitHubIdentity = { login: string; id: number; name?: string | null };
export type GitHubRepository = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  description?: string | null;
  language?: string | null;
  size?: number;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
  updated_at: string;
};

export type GitHubContentItem = {
  type: "file" | "dir" | "symlink" | "submodule";
  name: string;
  path: string;
  sha: string;
  size?: number;
  encoding?: string;
  content?: string;
  download_url?: string | null;
  html_url?: string | null;
};

function assertRepository(owner: string, repo: string) {
  if (!GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    throw new ApiError(400, "GITHUB_RESOURCE_INVALID", "اسم مالك المستودع أو المستودع غير صالح.");
  }
}

function encodeContentPath(path: string) {
  if (path.startsWith("/") || path.includes("..") || path.length > 1000) {
    throw new ApiError(400, "GITHUB_RESOURCE_INVALID", "مسار الملف غير صالح.");
  }
  return path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
}

export function verifyGitHubToken(token: string) {
  return githubRequest<GitHubIdentity>(token, "/user");
}

export function listGitHubRepositories(token: string, limit = 20) {
  return githubRequest<GitHubRepository[]>(
    token,
    `/user/repos?sort=updated&direction=desc&per_page=${Math.min(Math.max(limit, 1), 50)}&affiliation=owner,collaborator,organization_member`,
  );
}

export function readGitHubContents(token: string, owner: string, repo: string, path = "", ref?: string) {
  assertRepository(owner, repo);
  const suffix = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return githubRequest<GitHubContentItem | GitHubContentItem[]>(
    token,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodeContentPath(path)}${suffix}`,
  );
}

export async function readGitHubFile(token: string, owner: string, repo: string, path: string, ref?: string) {
  const content = await readGitHubContents(token, owner, repo, path, ref);
  if (Array.isArray(content) || content.type !== "file") {
    throw new ApiError(422, "GITHUB_FILE_REQUIRED", "المسار المحدد ليس ملفًا قابلًا للقراءة.");
  }
  return content;
}
