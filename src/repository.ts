import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describeFailure, runGit } from './git.js';
import type { RepoStatus, ScanState, UrlType } from './types.js';

const MAIN_BRANCHES = new Set(['master', 'main']);

type Protocol = 'ssh' | 'https' | 'other';

/** See "GIT URLS" in `git help fetch` for all the spellings git accepts. */
export function classifyUrl(url: string): Protocol {
  if (/^https?:\/\//i.test(url)) {
    return 'https';
  }
  if (/^(ssh|git\+ssh|ssh\+git):\/\//i.test(url)) {
    return 'ssh';
  }
  // git://, file://, and <transport>::<address> for remote helpers.
  if (/^[a-z][a-z0-9+.-]*(:\/\/|::)/i.test(url)) {
    return 'other';
  }
  // scp-like syntax, [user@]host:path. git only reads it that way when no
  // slash comes before the first colon; otherwise it's a local path.
  if (/^[^/]+:/.test(url)) {
    return 'ssh';
  }
  return 'other';
}

function combineUrlTypes(urls: readonly string[]): UrlType {
  if (urls.length === 0) {
    return 'none';
  }
  const protocols = new Set(urls.map(classifyUrl));
  if (protocols.has('ssh') && protocols.has('https')) {
    return 'ssh+https';
  }
  if (protocols.has('ssh')) {
    return 'ssh';
  }
  if (protocols.has('https')) {
    return 'https';
  }
  return 'other';
}

/** Lines of `git remote -v` look like "origin\tgit@github.com:me/x.git (fetch)". */
function parseRemoteUrls(output: string): string[] {
  const urls: string[] = [];
  for (const line of output.split('\n')) {
    const match = /^\S+\t(.*) \((?:fetch|push)\)$/.exec(line);
    if (match) {
      urls.push(match[1]!);
    }
  }
  return urls;
}

/** Everything after the nth space. File names can contain spaces. */
function afterNthSpace(record: string, n: number): string {
  let index = -1;
  for (let i = 0; i < n; i++) {
    index = record.indexOf(' ', index + 1);
  }
  return record.slice(index + 1);
}

/**
 * Fills in `repo` from `git status --porcelain=v2 --branch -z`. Returns the
 * paths of the uncommitted and untracked files, relative to the repository.
 */
function applyStatus(repo: RepoStatus, output: string): string[] {
  let oid = '';
  let head = '';
  let upstream: string | undefined;
  let hasAheadBehind = false;
  const paths: string[] = [];

  // With -z every record ends in a NUL, and nothing is quoted.
  const records = output.split('\0');
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.startsWith('# branch.oid ')) {
      oid = record.slice('# branch.oid '.length);
    } else if (record.startsWith('# branch.head ')) {
      head = record.slice('# branch.head '.length);
    } else if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length);
    } else if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        repo.ahead = Number(match[1]);
        repo.behind = Number(match[2]);
        hasAheadBehind = true;
      }
    } else if (record.startsWith('1 ')) {
      repo.changed++;
      paths.push(afterNthSpace(record, 8));
    } else if (record.startsWith('2 ')) {
      // Renamed or copied. The next record is the old name; skip it.
      repo.changed++;
      paths.push(afterNthSpace(record, 9));
      i++;
    } else if (record.startsWith('u ')) {
      repo.changed++;
      paths.push(afterNthSpace(record, 10));
    } else if (record.startsWith('? ')) {
      repo.untracked++;
      paths.push(record.slice(2));
    }
  }

  const detached = head === '(detached)';
  repo.branch = detached ? `(detached ${oid.slice(0, 7)})` : head;
  repo.onMainBranch = MAIN_BRANCHES.has(head);
  repo.noUpstream = !repo.noRemote && !detached && upstream === undefined;
  // git names the upstream but can't compare against it: the remote branch
  // is gone (deleted on the server and pruned, or never fetched).
  repo.upstreamGone = upstream !== undefined && !hasAheadBehind;
  return paths;
}

/** When a commit was made, in ms. Undefined if there's no such commit. */
async function commitDate(repoPath: string, revision: string): Promise<number | undefined> {
  const result = await runGit(repoPath, ['log', '-1', '--format=%ct', revision, '--']);
  const seconds = Number(result.stdout.trim());
  return result.ok && seconds > 0 ? seconds * 1000 : undefined;
}

/**
 * When this file was last modified. A deleted file has no time of its own,
 * so use the time of its directory, which changed when the file went away.
 */
async function modificationTime(repoPath: string, filePath: string): Promise<number | undefined> {
  let current = path.join(repoPath, filePath);
  while (true) {
    try {
      return (await fs.lstat(current)).mtimeMs;
    } catch {
      const parent = path.dirname(current);
      if (parent === current || path.relative(repoPath, parent).startsWith('..')) {
        return undefined;
      }
      current = parent;
    }
  }
}

function newest(times: readonly (number | undefined)[]): number | undefined {
  const known = times.filter((time) => time !== undefined);
  return known.length > 0 ? Math.max(...known) : undefined;
}

/**
 * When whatever needs attention last changed, so the list can be sorted like
 * an inbox. The newest of:
 *  - uncommitted and untracked files: when they were last modified,
 *  - commits to push: the newest of them (HEAD),
 *  - commits to pull: the newest of them (the upstream).
 * If none of those apply, the last commit.
 */
async function attentionDate(
  repo: RepoStatus,
  uncommittedPaths: readonly string[],
  startStep: (command: string) => void,
): Promise<number | undefined> {
  const times: (number | undefined)[] = [];
  if (uncommittedPaths.length > 0) {
    startStep('file times');
    times.push(
      ...(await Promise.all(uncommittedPaths.map((file) => modificationTime(repo.path, file)))),
    );
  }
  if (repo.behind > 0) {
    startStep('git log');
    times.push(await commitDate(repo.path, '@{upstream}'));
  }
  if (repo.ahead > 0 || newest(times) === undefined) {
    startStep('git log');
    times.push(await commitDate(repo.path, 'HEAD'));
  }
  return newest(times);
}

/** May return early, with `repo.error` set. */
async function inspect(
  repo: RepoStatus,
  fetch: boolean,
  startStep: (command: string) => void,
): Promise<void> {
  startStep('git remote');
  const remotes = await runGit(repo.path, ['remote', '-v']);
  if (!remotes.ok) {
    repo.error = describeFailure(remotes);
    return;
  }
  const urls = parseRemoteUrls(remotes.stdout);
  repo.urlType = combineUrlTypes(urls);
  repo.noRemote = urls.length === 0;

  if (fetch && !repo.noRemote) {
    startStep('git fetch');
    const fetched = await runGit(repo.path, ['fetch', '--all', '--quiet']);
    if (!fetched.ok) {
      repo.fetchError = describeFailure(fetched);
    }
  }

  startStep('git status');
  const status = await runGit(repo.path, [
    // Don't take the index lock just to refresh it, so we never get in the
    // way of VS Code or another git in the same repository.
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    // List each untracked file, not just its directory, so we can see when
    // each was modified. Ignored files are still left out.
    '--untracked-files=all',
  ]);
  if (!status.ok) {
    repo.error = describeFailure(status);
    return;
  }
  const uncommittedPaths = applyStatus(repo, status.stdout);
  repo.date = await attentionDate(repo, uncommittedPaths, startStep);
}

/** Never rejects; problems are reported in the result's `error` field. */
export async function checkRepository(
  repoPath: string,
  fetch: boolean,
  state: ScanState,
): Promise<RepoStatus> {
  const repo: RepoStatus = {
    path: repoPath,
    urlType: 'none',
    branch: '?',
    onMainBranch: false,
    noRemote: false,
    noUpstream: false,
    upstreamGone: false,
    fetchError: undefined,
    ahead: 0,
    behind: 0,
    changed: 0,
    untracked: 0,
    date: undefined,
    error: undefined,
  };
  const startStep = (command: string) =>
    state.activity.set(repoPath, { command, startTime: Date.now() });

  try {
    await inspect(repo, fetch, startStep);
    // No commits yet, or git couldn't read the repository.
    repo.date ??= await modificationTime(repoPath, '.');
  } catch (error) {
    repo.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.activity.delete(repoPath);
  }
  return repo;
}
