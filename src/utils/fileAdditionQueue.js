export class FileAdditionQueue {
  constructor() {
    this._chain = Promise.resolve();
  }

  /**
   * Enqueue a file processing task. Tasks execute sequentially.
   * @param {() => Promise<T>} taskFn
   * @returns {Promise<T>}
   */
  enqueue(taskFn) {
    const resultPromise = this._chain.then(taskFn);
    // Keep chain alive even if task fails
    this._chain = resultPromise.catch(() => {});
    return resultPromise;
  }
}

export const fileAdditionQueue = new FileAdditionQueue();
