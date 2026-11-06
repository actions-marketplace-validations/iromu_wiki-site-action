/**
 * Publish a built site directory to a branch (default: gh-pages) on the
 * current repo's origin, replacing the branch contents with the site.
 *
 * The deploy is staged in a throwaway clone so the consumer's checkout is
 * never disturbed. This is a small reimplementation of what
 * peaceiris/actions-gh-pages does: check out (or create) the publish branch,
 * clear it, copy the site in, commit, and push. The repo must already be
 * checked out with a write-capable origin (actions/checkout +
 * `permissions: contents: write` in the consumer workflow).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run a command, capturing stdout. Throws on non-zero exit unless allowFail.
function run(file, args, { allowFail = false, cwd } = {}) {
  try {
    return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  } catch (e) {
    if (allowFail) return (e.stdout ?? '').toString();
    throw e;
  }
}
const git = (args, opts) => run('git', args, opts);

// Copy the *contents* of src into dest (dest must exist).
function copyContents(src, dest) {
  for (const entry of readdirSync(src)) {
    cpSync(join(src, entry), join(dest, entry), { recursive: true });
  }
}

// Build a pushable origin URL. In a GitHub workflow, embed GITHUB_TOKEN in the
// HTTPS URL — the most reliable way to authenticate the deploy push. Locally
// (no GITHUB_TOKEN), fall back to the checkout's configured origin.
function originUrl() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  if (token && repo) {
    return server.replace(/^https:\/\//, `https://x-access-token:${token}@`) + `/${repo}.git`;
  }
  return git(['remote', 'get-url', 'origin']).trim();
}

/**
 * @param {object} o
 * @param {string} o.publishDir   absolute path to the built site
 * @param {string} o.publishBranch branch to publish to (default gh-pages)
 * @param {string} [o.subfolder]  optional subpath within the branch to place
 *                                the site (e.g. "docs" for project pages)
 */
export async function publish({ publishDir, publishBranch = 'gh-pages', subfolder = '' }) {
  const url = originUrl();
  if (!url) throw new Error('Could not determine the origin URL; is the repo checked out?');

  const stage = mkdtempSync(join(tmpdir(), 'ghpages-'));
  try {
    git(['init', '-q'], { cwd: stage });
    git(['config', 'user.name', 'github-actions[bot]'], { cwd: stage });
    git(['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], { cwd: stage });
    git(['remote', 'add', 'origin', url], { cwd: stage });

    // Fetch the publish branch if it already exists on the remote.
    git(['fetch', '-q', 'origin', publishBranch], { cwd: stage, allowFail: true });

    // Check it out (creating a local branch from the fetched one), or start orphan.
    try {
      git(['checkout', '-q', '-b', publishBranch, `origin/${publishBranch}`], { cwd: stage });
    } catch {
      git(['checkout', '-q', '--orphan', publishBranch], { cwd: stage });
    }

    // Clear any tracked files from the previous deploy (.git is untouched).
    git(['rm', '-rf', '-q', '.'], { cwd: stage, allowFail: true });

    // Copy the built site into the stage root (or under subfolder).
    const target = subfolder ? join(stage, subfolder) : stage;
    mkdirSync(target, { recursive: true });
    copyContents(publishDir, target);

    // Stage, commit only if there are changes, then push.
    git(['add', '-A'], { cwd: stage });
    const status = git(['status', '--porcelain'], { cwd: stage });
    if (status.trim().length > 0) {
      git(['commit', '-q', '-m', `Deploy wiki site (${new Date().toISOString()})`], { cwd: stage });
    }
    git(['push', '-q', 'origin', publishBranch], { cwd: stage });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
