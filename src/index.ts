import { killAllGit } from './git.js';
import { parseCommandLine } from './options.js';
import { OrderedPool } from './pool.js';
import { Display } from './render.js';
import { formatLine, shouldList, tally } from './report.js';
import { checkRepository } from './repository.js';
import { createScanState, type RepoStatus } from './types.js';
import { walkRoot } from './walk.js';

/**
 * How many repositories to check at once. Most of the time goes to waiting
 * on servers, so this is mostly how many connections are open at once.
 */
const PARALLEL_CHECKS = 8;

async function main(): Promise<void> {
  // `npm start` runs scripts from the package's own directory. Go back to
  // where the command was typed so relative paths, including the default
  // ".", mean what you'd expect.
  if (process.env.npm_lifecycle_event === 'start' && process.env.INIT_CWD) {
    process.chdir(process.env.INIT_CWD);
  }

  const options = parseCommandLine(process.argv.slice(2));
  if (options === undefined) {
    return;
  }

  const state = createScanState();
  const display = new Display(state, options);
  const pool = new OrderedPool<RepoStatus>(PARALLEL_CHECKS, (repo) => {
    if (shouldList(repo, options)) {
      state.counts.listed++;
      display.printLine(formatLine(repo));
    }
  });

  // git runs in its own session (see runGit), so Ctrl-C only reaches us.
  const interrupt = () => {
    killAllGit();
    state.interrupted = true;
    display.finish();
    process.exit(130);
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);

  display.start();
  try {
    for (const directory of options.directories) {
      const problem = await walkRoot(directory, state, (repoPath) => {
        state.counts.found++;
        pool.add(async () => {
          const repo = await checkRepository(repoPath, options.fetch, state);
          tally(state.counts, repo);
          return repo;
        });
      });
      if (problem !== undefined) {
        display.printLine(`git-all-status: ${problem}`, process.stderr);
        process.exitCode = 1;
      }
    }
    state.walkDone = true;
    await pool.drain();
  } finally {
    display.finish();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
