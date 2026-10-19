import type { Category, Options } from './options.js';
import type { Counts, RepoStatus } from './types.js';

function categoriesOf(repo: RepoStatus): Record<Category, boolean> {
  return {
    'not-connected':
      repo.noRemote || repo.noUpstream || repo.upstreamGone || repo.fetchError !== undefined,
    'needing-update': repo.ahead > 0 || repo.behind > 0,
    uncommitted: repo.changed > 0 || repo.untracked > 0,
    'not-master': !repo.onMainBranch,
    ssh: repo.urlType === 'ssh',
    https: repo.urlType === 'https',
    'ssh-and-https': repo.urlType === 'ssh+https',
  };
}

export function shouldList(repo: RepoStatus, options: Options): boolean {
  if (repo.error !== undefined || options.listAll) {
    return true;
  }
  const categories = categoriesOf(repo);
  return [...options.categories].some((category) => categories[category]);
}

export function tally(counts: Counts, repo: RepoStatus): void {
  counts.checked++;
  if (repo.error !== undefined) {
    counts.errors++;
    return;
  }
  const categories = categoriesOf(repo);
  counts.urlTypes[repo.urlType]++;
  if (categories['not-connected']) counts.notConnected++;
  if (repo.noRemote) counts.noRemote++;
  if (repo.noUpstream) counts.noUpstream++;
  if (repo.upstreamGone) counts.upstreamGone++;
  if (repo.fetchError !== undefined) counts.fetchFailed++;
  if (categories['needing-update']) counts.needingUpdate++;
  if (repo.ahead > 0) counts.needsPush++;
  if (repo.behind > 0) counts.needsPull++;
  if (categories.uncommitted) counts.uncommitted++;
  if (categories['not-master']) counts.notMaster++;
}

/** Oldest first. Ties (and the rare unknown date) go by path. */
export function compareRepos(a: RepoStatus, b: RepoStatus): number {
  const byDate = (a.date ?? 0) - (b.date ?? 0);
  if (byDate !== 0) {
    return byDate;
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Local time, fixed width so the list lines up: 2026-10-19 02:20 */
function formatDate(date: number | undefined): string {
  if (date === undefined) {
    return '????-??-?? ??:??';
  }
  const d = new Date(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** One line per repository, whatever got it listed. */
export function formatLine(repo: RepoStatus): string {
  const details: string[] = [];
  if (repo.error !== undefined) {
    details.push(`error: ${repo.error}`);
  } else {
    if (repo.noRemote) details.push('no remote');
    if (repo.noUpstream) details.push('no upstream');
    if (repo.upstreamGone) details.push('upstream gone');
    if (repo.ahead > 0) details.push(`ahead ${repo.ahead}`);
    if (repo.behind > 0) details.push(`behind ${repo.behind}`);
    if (repo.changed > 0) details.push(`${repo.changed} changed`);
    if (repo.untracked > 0) details.push(`${repo.untracked} untracked`);
    // Last, because it can be long.
    if (repo.fetchError !== undefined) details.push(`fetch failed: ${repo.fetchError}`);
  }
  return [
    formatDate(repo.date),
    repo.path,
    repo.urlType,
    repo.branch,
    details.join(', ') || 'ok',
  ].join('  ');
}
