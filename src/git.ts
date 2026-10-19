import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Fetching a big repository over a slow link can legitimately take a while,
 * but a hung connection shouldn't stall the whole run.
 */
const GIT_TIMEOUT_MS = 120_000;

/**
 * Git must never stop to ask for a password or a host key confirmation. It
 * would scribble over the status display, and with several fetches running
 * at once there'd be no telling which repository was asking. Fail instead,
 * and report the failure.
 */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  // Empty (rather than unset) stops git from falling back to core.askPass or
  // SSH_ASKPASS. VS Code's terminal sets GIT_ASKPASS to pop up a dialog.
  GIT_ASKPASS: '',
  SSH_ASKPASS_REQUIRE: 'never',
  GCM_INTERACTIVE: 'never',
};

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const running = new Set<ChildProcess>();

/**
 * Runs git in `cwd`. Resolves even when git fails; rejects only if git
 * couldn't be started at all.
 */
export function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    // detached gives git its own session with no controlling terminal, so
    // ssh can't open /dev/tty to ask for a passphrase or a host key
    // confirmation; it fails instead. It also means Ctrl-C doesn't reach
    // git directly. See killAllGit().
    const child = spawn('git', args, {
      cwd,
      env: GIT_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    running.add(child);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child);
    }, GIT_TIMEOUT_MS);

    const finish = () => {
      clearTimeout(timer);
      running.delete(child);
    };
    child.on('error', (error) => {
      finish();
      reject(error);
    });
    child.on('close', (code) => {
      finish();
      resolve({ ok: code === 0 && !timedOut, stdout, stderr, timedOut });
    });
  });
}

/** Kills git and anything it started (ssh, git-remote-https, ...). */
function killGroup(child: ChildProcess): void {
  if (child.pid === undefined) {
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

export function killAllGit(): void {
  for (const child of running) {
    killGroup(child);
  }
}

/**
 * The most useful line of git's complaint, for a one-line report. The first
 * line is usually the specific one ("Permission denied (publickey)",
 * "Repository not found"); later lines tend to be generic advice.
 */
export function describeFailure(result: GitResult): string {
  if (result.timedOut) {
    return `timed out after ${GIT_TIMEOUT_MS / 1000} seconds`;
  }
  const firstLine = result.stderr
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  return firstLine ?? 'git failed with no message';
}
