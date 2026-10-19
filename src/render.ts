import { logUpdateStderr as logUpdate } from 'log-update';
import { formatGrouped } from './format.js';
import { describeListing, type Options } from './options.js';
import type { ScanState } from './types.js';

// 60Hz, same cadence as a browser requestAnimationFrame loop. A handful of
// short text lines is cheap to write, so there's no need to throttle harder.
const RENDER_INTERVAL_MS = 1000 / 60;

function buildFrame(state: ScanState, options: Options): string {
  const stream = process.stderr;
  const n = (value: number) => formatGrouped(value, 0, stream);
  const seconds = (startTime: number, decimals: number) =>
    formatGrouped((Date.now() - startTime) / 1000, decimals, stream);
  const counts = state.counts;

  const lines: string[] = [
    `Start time ${new Date(state.startTime).toLocaleString()}, ${seconds(state.startTime, 3)} seconds ${
      state.done ? 'total' : 'ago'
    }.`,
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

  if (state.done) {
    if (state.interrupted) {
      lines.push('Interrupted.');
    }
  } else {
    lines.push(state.walkDone ? 'Scan finished, waiting for git.' : `Scanning ${state.currentPath}`);
    for (const [repoPath, activity] of state.activity) {
      lines.push(`  ${activity.command} ${repoPath} ${seconds(activity.startTime, 1)}s`);
    }
  }

  return lines.join('\n');
}

/**
 * The live status at the bottom of the terminal, with permanent lines
 * printed above it as we go.
 */
export class Display {
  readonly #state: ScanState;
  readonly #options: Options;
  /** Only draw the live status if someone is there to watch it. */
  readonly #live = process.stderr.isTTY === true;
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

  /**
   * Prints a permanent line. If it's going to the same terminal as the
   * status, the status gets out of the way first and is redrawn below it.
   */
  printLine(line: string, stream: NodeJS.WriteStream = process.stdout): void {
    const inTheWay = this.#live && !this.#state.done && stream.isTTY === true;
    if (inTheWay) {
      logUpdate.clear();
    }
    stream.write(line + '\n');
    if (inTheWay) {
      this.#redraw();
    }
  }

  /** Replaces the live status with the final summary. Safe to call twice. */
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
    process.stderr.write(buildFrame(this.#state, this.#options) + '\n');
  }

  #redraw(): void {
    logUpdate(buildFrame(this.#state, this.#options));
  }
}
