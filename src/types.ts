/**
 * Which protocols a repository's remotes use. `ssh+https` means at least
 * one of each. `other` covers local paths, file://, git:// and the like.
 */
export type UrlType = 'ssh' | 'https' | 'ssh+https' | 'other' | 'none';

/** Everything we learned about one repository. */
export interface RepoStatus {
  /** Built from the command-line argument, so it's relative if that was. */
  path: string;
  urlType: UrlType;
  /** The branch name, or `(detached abc1234)`. */
  branch: string;
  /** On master or main. */
  onMainBranch: boolean;
  noRemote: boolean;
  /** There are remotes, but the current branch isn't tracking anything. */
  noUpstream: boolean;
  /** The branch tracks something that no longer exists, e.g. deleted on the server. */
  upstreamGone: boolean;
  fetchError: string | undefined;
  /** Commits to push. */
  ahead: number;
  /** Commits to pull. */
  behind: number;
  /** Staged, modified, deleted, renamed or conflicted files. */
  changed: number;
  untracked: number;
  /** Set when git couldn't tell us anything useful about this repository. */
  error: string | undefined;
}

export interface Counts {
  found: number;
  checked: number;
  urlTypes: Record<UrlType, number>;
  notConnected: number;
  noRemote: number;
  noUpstream: number;
  upstreamGone: number;
  fetchFailed: number;
  needingUpdate: number;
  needsPush: number;
  needsPull: number;
  uncommitted: number;
  notMaster: number;
  errors: number;
  listed: number;
}

/** A git command that's running right now. */
export interface Activity {
  command: string;
  startTime: number;
}

export interface ScanState {
  startTime: number;
  directoriesScanned: number;
  symlinksSkipped: number;
  duplicateInodesSkipped: number;
  skippedMountPoints: string[];
  unreadableDirectories: number;
  currentPath: string;
  walkDone: boolean;
  /** Keys are `${dev}:${ino}`, only tracked for entries with nlink > 1. */
  seenInodes: Set<string>;
  /** Keyed by repository path. */
  activity: Map<string, Activity>;
  counts: Counts;
  done: boolean;
  interrupted: boolean;
}

export function createScanState(): ScanState {
  return {
    startTime: Date.now(),
    directoriesScanned: 0,
    symlinksSkipped: 0,
    duplicateInodesSkipped: 0,
    skippedMountPoints: [],
    unreadableDirectories: 0,
    currentPath: '',
    walkDone: false,
    seenInodes: new Set(),
    activity: new Map(),
    counts: {
      found: 0,
      checked: 0,
      urlTypes: { ssh: 0, https: 0, 'ssh+https': 0, other: 0, none: 0 },
      notConnected: 0,
      noRemote: 0,
      noUpstream: 0,
      upstreamGone: 0,
      fetchFailed: 0,
      needingUpdate: 0,
      needsPush: 0,
      needsPull: 0,
      uncommitted: 0,
      notMaster: 0,
      errors: 0,
      listed: 0,
    },
    done: false,
    interrupted: false,
  };
}
