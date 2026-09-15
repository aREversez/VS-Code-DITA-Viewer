// Git plumbing utilities for the DITA diff/compare feature.
// Uses child_process.execFile (no shell) for argument-safe invocation.
// All functions accept an optional injectable executor for testing.

import { execFile, ExecFileException } from 'child_process';
import * as vscode from 'vscode';
import { relative, sep } from 'path';

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitExecutor = (args: string[], cwd: string) => Promise<GitExecResult>;

export const defaultGitExecutor: GitExecutor = (args, cwd) =>
  new Promise((resolve, reject) => {
    execFile('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 15000 }, (err, stdout, stderr) => {
      const execErr = err as ExecFileException | null;
      if (execErr?.code === 'ENOENT') {
        reject(new Error('Git not found'));
        return;
      }
      // execFile's callback error has code: string | number -- a string
      // for OS-level errors like ENOENT (handled above), a number (the
      // process's actual exit code) when git ran but exited non-zero.
      // NodeJS.ErrnoException (a plain `any` cast was here before) only
      // declares code as string, which doesn't fit this second case;
      // ExecFileException is the type actually documented for execFile's
      // callback and correctly allows both.
      const code = typeof execErr?.code === 'number' ? execErr.code : execErr ? 1 : 0;
      resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });

const REF_RE = /^[A-Za-z0-9._/~^@[\]{}-]+$/;

function validateRef(ref: string): void {
  if (!REF_RE.test(ref) || ref.startsWith('-')) {
    throw new Error(`Invalid git ref: ${ref}`);
  }
}

export async function getRepoRoot(dir: string, exec: GitExecutor = defaultGitExecutor): Promise<string | undefined> {
  try {
    const result = await exec(['rev-parse', '--show-toplevel'], dir);
    if (result.code !== 0) return undefined;
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

export function toRepoRelPath(repoRoot: string, fsPath: string): string {
  return relative(repoRoot, fsPath).split(sep).join('/');
}

export async function isFileTracked(
  repoRoot: string,
  relPath: string,
  exec: GitExecutor = defaultGitExecutor,
): Promise<boolean> {
  const result = await exec(['ls-files', '--error-unmatch', '--', relPath], repoRoot);
  return result.code === 0;
}

export async function getFileAtRef(
  repoRoot: string,
  relPath: string,
  ref: string,
  exec: GitExecutor = defaultGitExecutor,
): Promise<string | undefined> {
  validateRef(ref);
  const result = await exec(['show', `${ref}:${relPath}`], repoRoot);
  if (result.code !== 0) return undefined;
  let content = result.stdout;
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return content;
}

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export async function listFileCommits(
  repoRoot: string,
  relPath: string,
  limit = 30,
  exec: GitExecutor = defaultGitExecutor,
): Promise<GitCommitInfo[]> {
  const result = await exec(
    ['log', '--follow', '--date=iso', `--pretty=format:%H%x00%h%x00%an%x00%ad%x00%s`, `-n`, String(limit), '--', relPath],
    repoRoot,
  );
  if (result.code !== 0 || !result.stdout.trim()) return [];

  const lines = result.stdout.trim().split('\n');
  const commits: GitCommitInfo[] = [];
  for (const line of lines) {
    const parts = line.split('\x00');
    if (parts.length < 5) continue;
    commits.push({
      hash: parts[0],
      shortHash: parts[1],
      author: parts[2],
      date: parts[3],
      subject: parts[4],
    });
  }
  return commits;
}

export async function hasUncommittedChanges(
  repoRoot: string,
  relPath: string,
  exec: GitExecutor = defaultGitExecutor,
): Promise<boolean> {
  const result = await exec(['status', '--porcelain', '--', relPath], repoRoot);
  return result.code === 0 && result.stdout.trim().length > 0;
}

export async function getLocalContent(uri: vscode.Uri): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(uri);
  return doc.getText();
}
