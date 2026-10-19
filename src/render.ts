import { logUpdateStderr as logUpdate } from 'log-update';
import sliceAnsi from 'slice-ansi';
import stringWidth from 'string-width';
import { formatGrouped } from './format.js';
import { describeListing, type Options } from './options.js';
import { compareRepos, formatLine } from './report.js';
import type { RepoStatus, ScanState } from './types.js';

// 60Hz, same cadence as a browser requestAnimationFrame loop. A screenful of
// short text lines is cheap to write, so there's no need to throttle harder.
const RENDER_INTERVAL_MS = 1000 / 60;

function buildSummary(state: ScanState, options: Options): string[] {
  const stream = process.stderr;
  const n = (value: number) => formatGrouped(value, 0, stream);
  const elapsedSeconds = (Date.now() - state.startTime) / 1000;
  const counts = state.counts;

  const lines: string[] = [
    `Start time ${new Date(state.startTime).toLocaleString()}, ${formatGrouped(
      elapsedSeconds,
      3,
      stream,
    )} seconds ${state.done ? 'total' : 'ago'}.`,
    `Directories scanned: ${n(state.directoriesScanned)}`,
    `Symbolic links skipped: ${n(state.symlinksSkipped)}`,
  ];

  if (state.duplicateInodesSkipped > 0) {
    lines.push(`Duplicate inodes skipped: ${n(state.duplicateInodesSkipped)}`);
  }
  if (state.skippedMountPoints.length > 0) {
    lines.push(`Mount points skipped: ${state.skippedMountPoints.join(', ')}`);
  }
  if (state.unreadableDirectories > 0) {
    lines.push(`Unreadable directories skipped: ${n(state.unreadableDirectories)}`);
  }

  const urlTypes = counts.urlTypes;
  lines.push(
    `Repositories: ${n(counts.found)} found, ${n(counts.checked)} checked`,
    `URL types: ${n(urlTypes.ssh)} ssh, ${n(urlTypes.https)} https, ${n(
      urlTypes['ssh+https'],
    )} ssh+https, ${n(urlTypes.other)} other, ${n(urlTypes.none)} none`,
    `Not connected: ${n(counts.notConnected)} (${n(counts.noRemote)} no remote, ${n(
      counts.noUpstream,
    )} no upstream, ${n(counts.upstreamGone)} upstream gone, ${n(
      counts.fetchFailed,
    )} fetch failed)`,
    `Needing update: ${n(counts.needingUpdate)} (${n(counts.needsPush)} need push, ${n(
      counts.needsPull,
    )} need pull)`,
    `Uncommitted or untracked files: ${n(counts.uncommitted)}`,
    `Not on master or main: ${n(counts.notMaster)}`,
  );
  if (counts.errors > 0) {
    lines.push(`Errors: ${n(counts.errors)}`);
  }
  lines.push(`Listed: ${n(counts.listed)} (${describeListing(options)})`);
  if (!options.fetch) {
    lines.push('Servers not contacted (--no-fetch).');
  }
  if (state.interrupted) {
    lines.push('Interrupted.');
  }
  return lines;
}

/** What's happening right now. Only shown while running. */
function buildProgress(state: ScanState): string[] {
  const lines = [
    state.walkDone ? 'Scan finished, waiting for git.' : `Scanning ${state.currentPath}`,
  ];
  if (state.activity.size > 0) {
    // Longest-running first: if something is stuck, that's what you'll see.
    const running = [...state.activity]
      .sort(([, a], [, b]) => a.startTime - b.startTime)
      .map(([repoPath, activity]) => {
        const seconds = formatGrouped((Date.now() - activity.startTime) / 1000, 1, process.stderr);
        return `${activity.command} ${repoPath} ${seconds}s`;
      });
    lines.push(`Running: ${running.join(', ')}`);
  }
  return lines;
}

/**
 * Cut a line to the terminal's width. log-update erases by counting lines,
 * and a line that wraps would throw that count off once the display fills
 * the screen.
 */
function fitWidth(line: string, columns: number): string {
  return stringWidth(line) <= columns ? line : sliceAnsi(line, 0, columns - 1) + '…';
}

/**
 * The live display: the list of repositories so far, sorted, with the
 * summary and progress below it. When it's all done, the full list goes to
 * stdout and the summary to stderr, as permanent lines.
 */
export class Display {
  readonly #state: ScanState;
  readonly #options: Options;
  /** Only draw the live display if someone is there to watch it. */
  readonly #live = process.stderr.isTTY === true;
  /** Oldest first. */
  readonly #listed: RepoStatus[] = [];
  #interval: NodeJS.Timeout | undefined;

  constructor(state: ScanState, options: Options) {
    this.#state = state;
    this.#options = options;
  }

  start(): void {
    if (this.#live) {
      // Independent of the walk, so it keeps showing the last-known path
      // and how long each git command has been running, even if something
      // hangs.
      this.#interval = setInterval(() => this.#redraw(), RENDER_INTERVAL_MS);
      this.#redraw();
    }
  }

  /** Adds a repository to the list, in date order. */
  list(repo: RepoStatus): void {
    this.#listed.push(repo);
    this.#listed.sort(compareRepos);
  }

  /**
   * Prints a permanent line on stderr. The live display gets out of the way
   * first and is redrawn below it.
   */
  printMessage(line: string): void {
    const inTheWay = this.#live && !this.#state.done;
    if (inTheWay) {
      logUpdate.clear();
    }
    process.stderr.write(line + '\n');
    if (inTheWay) {
      this.#redraw();
    }
  }

  /** Replaces the live display with the final list and summary. Safe to call twice. */
  finish(): void {
    if (this.#state.done) {
      return;
    }
    clearInterval(this.#interval);
    this.#state.done = true;
    if (this.#live) {
      logUpdate.clear();
      logUpdate.done();
    }
    for (const repo of this.#listed) {
      process.stdout.write(formatLine(repo) + '\n');
    }
    process.stderr.write(buildSummary(this.#state, this.#options).join('\n') + '\n');
  }

  #redraw(): void {
    const stream = process.stderr;
    const columns = stream.columns || 80;
    const rows = stream.rows || 24;
    const status = [...buildSummary(this.#state, this.#options), ...buildProgress(this.#state)];

    // log-update adds a newline at the end, so rows - 1 lines fill the
    // screen. If the list doesn't fit, the oldest wait for the final output,
    // where they'll be at the top of the list, likely scrolled off anyway.
    const room = rows - 1 - status.length;
    let list = this.#listed.map(formatLine);
    if (list.length > room) {
      const hidden = list.length - Math.max(0, room - 1);
      list = room > 0 ? [`(${hidden} older not shown yet)`, ...list.slice(hidden)] : [];
    }

    logUpdate([...list, ...status].map((line) => fitWidth(line, columns)).join('\n'));
  }
}
