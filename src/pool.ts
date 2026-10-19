interface Waiting<T> {
  sequence: number;
  task: () => Promise<T>;
}

/**
 * Runs up to `limit` tasks at once, and hands their results to `deliver` in
 * the order the tasks were added, no matter which finishes first.
 *
 * Tasks must not reject.
 */
export class OrderedPool<T> {
  readonly #limit: number;
  readonly #deliver: (result: T) => void;
  readonly #waiting: Waiting<T>[] = [];
  readonly #finished = new Map<number, T>();
  #running = 0;
  #nextSequence = 0;
  #nextToDeliver = 0;
  #onIdle: (() => void) | undefined;

  constructor(limit: number, deliver: (result: T) => void) {
    this.#limit = limit;
    this.#deliver = deliver;
  }

  /** Doesn't wait; the task starts as soon as there's room. */
  add(task: () => Promise<T>): void {
    this.#waiting.push({ sequence: this.#nextSequence++, task });
    this.#startMore();
  }

  /** Resolves once every task added so far has finished and been delivered. */
  drain(): Promise<void> {
    return new Promise((resolve) => {
      this.#onIdle = resolve;
      this.#checkIdle();
    });
  }

  #startMore(): void {
    while (this.#running < this.#limit && this.#waiting.length > 0) {
      const { sequence, task } = this.#waiting.shift()!;
      this.#running++;
      task()
        .then((result) => {
          this.#finished.set(sequence, result);
          this.#deliverReady();
        })
        .finally(() => {
          this.#running--;
          this.#startMore();
          this.#checkIdle();
        });
    }
  }

  #deliverReady(): void {
    while (this.#finished.has(this.#nextToDeliver)) {
      const result = this.#finished.get(this.#nextToDeliver)!;
      this.#finished.delete(this.#nextToDeliver);
      this.#nextToDeliver++;
      this.#deliver(result);
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
