import { parseArgs } from 'node:util';

/** Each category has a --show-all-<category> option. */
export const CATEGORIES = [
  'not-connected',
  'needing-update',
  'uncommitted',
  'not-master',
  'ssh',
  'https',
  'ssh-and-https',
] as const;
export type Category = (typeof CATEGORIES)[number];

const DEFAULT_CATEGORIES: readonly Category[] = [
  'not-connected',
  'needing-update',
  'uncommitted',
];

export interface Options {
  /** Never empty; defaults to ".". */
  directories: string[];
  /** --show-all-repositories */
  listAll: boolean;
  /** List a repository if it's in any of these. */
  categories: Set<Category>;
  fetch: boolean;
}

const HELP = `Usage: git-all-status [options] [--] [directory ...]

Finds every git repository under each directory (default: the current
directory) and lists the ones that need attention.

It walks down from each directory, stopping at any directory that contains
.git. Symbolic links, duplicate inodes (hard links) and mount points are
skipped and counted. For each repository it runs "git fetch --all" to see
what's new on the server, then "git status".

Each repository listed gets one line:
  <path>  <url type>  <branch>  <details>
The url type is ssh, https, ssh+https, other or none. The details are some
of: no remote, no upstream, upstream gone, ahead N, behind N, N changed,
N untracked, fetch failed: <reason>. Or just ok.

What to list (combine as many as you like):
  --show-all-not-connected   No remote, the branch has no upstream, the
                             upstream branch is gone, or the fetch failed.
  --show-all-needing-update  The branch is ahead of its upstream (needs a
                             push) or behind it (needs a pull).
  --show-all-uncommitted     Changed or untracked files.
  --show-all-not-master      Not on master or main, including detached HEAD.
  --show-all-ssh             Remotes use ssh and not https.
  --show-all-https           Remotes use https and not ssh.
                             (--show-all-http works too.)
  --show-all-ssh-and-https   Some remotes use ssh and some use https.
  --show-all-repositories    Every repository.
With none of these, the default is --show-all-not-connected
--show-all-needing-update --show-all-uncommitted. Repositories that git can't
read are always listed. The summary at the end counts every category.

Other options:
  --no-fetch    Don't contact any servers. Ahead/behind are then as of each
                repository's last fetch.
  -h, --help    Show this help.
  --            Everything after this is a directory, even if it starts
                with -.

Repository lines go to stdout. The live status and summary go to stderr.
`;

/**
 * Returns undefined if the program should stop now: after --help, or after
 * reporting a bad option (with process.exitCode set).
 */
export function parseCommandLine(args: string[]): Options | undefined {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        'no-fetch': { type: 'boolean' },
        'show-all-repositories': { type: 'boolean' },
        'show-all-http': { type: 'boolean' },
        ...Object.fromEntries(
          CATEGORIES.map((category) => [`show-all-${category}`, { type: 'boolean' as const }]),
        ),
      },
    });
  } catch (error) {
    console.error(`git-all-status: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Try git-all-status --help');
    process.exitCode = 2;
    return undefined;
  }

  const { positionals } = parsed;
  // The category options are built at runtime, so TypeScript can't see them.
  const values: Record<string, unknown> = parsed.values;
  if (values.help) {
    process.stdout.write(HELP);
    return undefined;
  }

  const categories = new Set(
    CATEGORIES.filter((category) => values[`show-all-${category}`] === true),
  );
  if (values['show-all-http']) {
    categories.add('https');
  }
  const listAll = values['show-all-repositories'] === true;
  if (categories.size === 0 && !listAll) {
    for (const category of DEFAULT_CATEGORIES) {
      categories.add(category);
    }
  }

  return {
    directories: positionals.length > 0 ? positionals : ['.'],
    listAll,
    categories,
    fetch: values['no-fetch'] !== true,
  };
}

/** For the summary: what got listed. */
export function describeListing(options: Options): string {
  return options.listAll ? 'all repositories' : [...options.categories].join(', ');
}
