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

/** Fills in `repo` from `git status --porcelain=v2 --branch`. */
function applyStatus(repo: RepoStatus, output: string): void {
  let oid = '';
  let head = '';
  let upstream: string | undefined;
  let hasAheadBehind = false;

  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      oid = line.slice('# branch.oid '.length);
    } else if (line.startsWith('# branch.head ')) {
      head = line.slice('# branch.head '.length);
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (match) {
        repo.ahead = Number(match[1]);
        repo.behind = Number(match[2]);
        hasAheadBehind = true;
      }
    } else if (line.startsWith('? ')) {
      repo.untracked++;
    } else if (/^[12u] /.test(line)) {
      repo.changed++;
    }
  }

  const detached = head === '(detached)';
  repo.branch = detached ? `(detached ${oid.slice(0, 7)})` : head;
  repo.onMainBranch = MAIN_BRANCHES.has(head);
  repo.noUpstream = !repo.noRemote && !detached && upstream === undefined;
  // git names the upstream but can't compare against it: the remote branch
  // is gone (deleted on the server and pruned, or never fetched).
  repo.upstreamGone = upstream !== undefined && !hasAheadBehind;
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
    error: undefined,
  };
  const startStep = (command: string) =>
    state.activity.set(repoPath, { command, startTime: Date.now() });

  try {
    startStep('git remote');
    const remotes = await runGit(repoPath, ['remote', '-v']);
    if (!remotes.ok) {
      repo.error = describeFailure(remotes);
      return repo;
    }
    const urls = parseRemoteUrls(remotes.stdout);
    repo.urlType = combineUrlTypes(urls);
    repo.noRemote = urls.length === 0;

    if (fetch && !repo.noRemote) {
      startStep('git fetch');
      const fetched = await runGit(repoPath, ['fetch', '--all', '--quiet']);
      if (!fetched.ok) {
        repo.fetchError = describeFailure(fetched);
      }
    }

    startStep('git status');
    // --no-optional-locks: don't take the index lock just to refresh it, so
    // we never get in the way of VS Code or another git in the same repo.
    const status = await runGit(repoPath, [
      '--no-optional-locks',
      'status',
      '--porcelain=v2',
      '--branch',
    ]);
    if (!status.ok) {
      repo.error = describeFailure(status);
      return repo;
    }
    applyStatus(repo, status.stdout);
  } catch (error) {
    repo.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.activity.delete(repoPath);
  }
  return repo;
}
