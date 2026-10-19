import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import type { ScanState } from './types.js';

type OnRepository = (repoPath: string) => void;

/**
 * True if we've already been here: a hard link, or the same directory
 * named twice on the command line. Remembers the inode either way.
 */
function alreadySeen(stat: Stats, state: ScanState): boolean {
  // stat.ino === 0 means this filesystem doesn't support inode numbers;
  // never treat anything on it as a hard link.
  if (stat.ino === 0 || stat.nlink <= 1) {
    return false;
  }
  const key = `${stat.dev}:${stat.ino}`;
  if (state.seenInodes.has(key)) {
    return true;
  }
  state.seenInodes.add(key);
  return false;
}

async function walk(
  dirPath: string,
  dev: number,
  state: ScanState,
  onRepository: OnRepository,
): Promise<void> {
  state.currentPath = dirPath;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    // Unreadable directory (permissions, broken mount, etc.) - skip it.
    state.unreadableDirectories++;
    return;
  }

  state.directoriesScanned++;

  // A .git directory (or a .git file, for worktrees and submodules) marks a
  // repository. Don't look any deeper.
  if (entries.some((entry) => entry.name === '.git')) {
    onRepository(dirPath);
    return;
  }

  // Sorted so the repositories come out in the same order every run.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    // Symlinks are never followed, whatever they point to.
    if (entry.isSymbolicLink()) {
      state.symlinksSkipped++;
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    state.currentPath = fullPath;

    let stat;
    try {
      stat = await fs.lstat(fullPath);
    } catch {
      state.unreadableDirectories++;
      continue;
    }

    if (alreadySeen(stat, state)) {
      state.duplicateInodesSkipped++;
      continue;
    }
    if (stat.dev !== dev) {
      state.skippedMountPoints.push(fullPath);
      continue;
    }
    await walk(fullPath, stat.dev, state, onRepository);
  }
}

/**
 * Walks one command-line argument, calling `onRepository` for each
 * repository found. Like `ls` and `find -H`, the argument itself is followed
 * if it's a symbolic link; nothing below it is.
 *
 * Returns an error message if the argument isn't a directory we can walk.
 */
export async function walkRoot(
  rootPath: string,
  state: ScanState,
  onRepository: OnRepository,
): Promise<string | undefined> {
  state.currentPath = rootPath;

  let stat;
  try {
    stat = await fs.stat(rootPath);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!stat.isDirectory()) {
    return `${rootPath}: Not a directory`;
  }
  if (alreadySeen(stat, state)) {
    state.duplicateInodesSkipped++;
    return undefined;
  }

  await walk(rootPath, stat.dev, state, onRepository);
  return undefined;
}
