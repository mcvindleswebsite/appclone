import { execSync } from "node:child_process";

import type { NextConfig } from "next";

const git = (args: string) =>
  execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * Asks GitHub for the commit count: with per_page=1, the "last" page number
 * in the Link header equals the number of commits reachable from `sha`.
 */
const fetchGitHubCommitCount = async (owner: string, repo: string, sha: string) => {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/commits?sha=${sha}&per_page=1`,
    { headers: { Accept: "application/vnd.github+json" } }
  );
  if (!response.ok) return null;
  const lastPage = response.headers.get("link")?.match(/[?&]page=(\d+)>; rel="last"/)?.[1];
  if (lastPage) return Number(lastPage);
  const commits: unknown[] = await response.json();
  return commits.length;
};

/**
 * Total commits on HEAD, for the About screen's version number. Vercel builds
 * from a shallow clone, where `git rev-list --count` only sees the last few
 * commits, so shallow checkouts ask GitHub instead.
 */
const getCommitCount = async () => {
  try {
    if (git("rev-parse --is-shallow-repository") !== "true") {
      return Number(git("rev-list --count HEAD"));
    }
  } catch {
    // Not a git checkout; fall through to the GitHub lookup.
  }

  const { VERCEL_GIT_REPO_OWNER, VERCEL_GIT_REPO_SLUG, VERCEL_GIT_COMMIT_SHA } = process.env;
  if (VERCEL_GIT_REPO_OWNER && VERCEL_GIT_REPO_SLUG && VERCEL_GIT_COMMIT_SHA) {
    try {
      const count = await fetchGitHubCommitCount(
        VERCEL_GIT_REPO_OWNER,
        VERCEL_GIT_REPO_SLUG,
        VERCEL_GIT_COMMIT_SHA
      );
      if (count) return count;
    } catch {
      // Offline or rate-limited; use the shallow count below.
    }
  }

  try {
    return Number(git("rev-list --count HEAD"));
  } catch {
    return 0;
  }
};

const createConfig = async (): Promise<NextConfig> => ({
  output: "standalone",
  env: {
    NEXT_PUBLIC_APP_VERSION: `1.0.${await getCommitCount()}`,
  },
});

export default createConfig;
