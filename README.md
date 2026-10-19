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

One line per repository, as soon as it's checked, above the live status:

```
du  ssh  master  3 changed
ts-gs  https  master  behind 2, 3 changed
curves  none  main  no remote, 5 changed, 1 untracked
```

`<path>  <url type>  <branch>  <details>`.
The summary at the end counts every category, whether or not it was listed.

By default it lists repositories that are not connected, need a push or pull, or have uncommitted or untracked files.
`--show-all-ssh`, `--show-all-https`, `--show-all-not-master`, etc. pick what to list instead.
See `git-all-status --help`.

Repository lines go to stdout; the live status and summary go to stderr.
So `git-all-status > list.txt` still shows progress, and the file gets just the list.

## Notes

- Runs `git fetch --all` in every repository with a remote, 8 at a time. `--no-fetch` skips that.
- Git is never allowed to prompt. A fetch that needs a password, an ssh passphrase not loaded in your agent, or a new host key fails and is reported as `fetch failed: <reason>`.
- Symbolic links, duplicate inodes (hard links) and mount points are skipped and counted, as in du.
- "Not on master" means not on `master` or `main`.
