# git-all-status

Status across many git repositories at once.
Walks a directory tree, stops at each git repository, asks each server what's new, and lists the repositories that need attention: no remote, needs a push or pull, uncommitted work.
Shows live status while it runs, like [du](https://github.com/TradeIdeasPhilip/du).

## Running it

```
npm install
npm link                  # once: puts git-all-status on your PATH
git-all-status ~/Documents/fun-git
```

Or without linking: `npm start -- [options] [directory ...]`.
Relative paths are relative to where you typed the command.

## Output

One line per repository, sorted like an inbox: oldest at the top, newest at the bottom, right above the summary.

```
2025-03-02 14:07  curves  none  main  no remote, 5 changed, 1 untracked
2026-09-30 21:15  ts-gs  https  master  behind 2, 3 changed
2026-10-19 01:58  du  ssh  master  3 changed
```

`<date>  <path>  <url type>  <branch>  <details>`.
The date is when whatever needs attention last changed:
the newest uncommitted or untracked file, the newest commit to push, or the newest commit to pull.
If none of those apply, it's the last commit.

The list stays sorted while it runs, above the live summary.
When it doesn't fit on the screen, the oldest rows wait for the end, when the whole list is printed for good.
The summary at the end counts every category, whether or not it was listed.

By default it lists repositories that are not connected, need a push or pull, or have uncommitted or untracked files.
`--show-all-ssh`, `--show-all-https`, `--show-all-not-master`, etc. pick what to list instead.
See `git-all-status --help`.

The final list goes to stdout; the live display and summary go to stderr.
So `git-all-status > list.txt` still shows progress, and the file gets just the list.

## Notes

- Runs `git fetch --all` in every repository with a remote, 8 at a time. `--no-fetch` skips that.
- Git is never allowed to prompt. A fetch that needs a password, an ssh passphrase not loaded in your agent, or a new host key fails and is reported as `fetch failed: <reason>`.
- Symbolic links, duplicate inodes (hard links) and mount points are skipped and counted, as in du.
- "Not on master" means not on `master` or `main`.
- "N untracked" counts files, not folders, so it can be bigger than what plain `git status` shows. Ignored files never count.
