export class FileAdditionQueue {
  private chain: Promise<unknown>;

  constructor() {
    this.chain = Promise.resolve();
  }

  enqueue<T>(taskFn: () => Promise<T>): Promise<T> {
    const resultPromise = this.chain.then(taskFn);
    // Keep chain alive even if task fails
    this.chain = resultPromise.catch(() => undefined);
    return resultPromise;
  }
}

export const fileAdditionQueue = new FileAdditionQueue();
