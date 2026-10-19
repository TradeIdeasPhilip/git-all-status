/** Runs up to `limit` tasks at once. Tasks must not reject. */
export class Pool {
  readonly #limit: number;
  readonly #waiting: (() => Promise<void>)[] = [];
  #running = 0;
  #onIdle: (() => void) | undefined;

  constructor(limit: number) {
    this.#limit = limit;
  }

  /** Doesn't wait; the task starts as soon as there's room. */
  add(task: () => Promise<void>): void {
    this.#waiting.push(task);
    this.#startMore();
  }

  /** Resolves once every task added so far has finished. */
  drain(): Promise<void> {
    return new Promise((resolve) => {
      this.#onIdle = resolve;
      this.#checkIdle();
    });
  }

  #startMore(): void {
    while (this.#running < this.#limit && this.#waiting.length > 0) {
      const task = this.#waiting.shift()!;
      this.#running++;
      task().finally(() => {
        this.#running--;
        this.#startMore();
        this.#checkIdle();
      });
    }
  }

  #checkIdle(): void {
    if (this.#running === 0 && this.#waiting.length === 0 && this.#onIdle) {
      const onIdle = this.#onIdle;
      this.#onIdle = undefined;
      onIdle();
    }
  }
}
