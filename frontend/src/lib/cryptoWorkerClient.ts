import type { CryptoWorkerRequest, CryptoWorkerResponse } from '../workers/crypto.worker.ts';

class CryptoWorkerClient {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (reason?: any) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private requestCounter = 0;
  private isWorkerSupported = typeof window !== 'undefined' && typeof window.Worker !== 'undefined';

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (!this.isWorkerSupported) return;

    try {
      this.worker = new Worker(
        new URL('../workers/crypto.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
        const { id, success, result, error } = event.data;
        const pending = this.pendingRequests.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error || 'Worker crypto operation failed'));
          }
        }
      };

      this.worker.onerror = (err) => {
        console.warn('Crypto Web Worker error, falling back to main-thread execution', err);
      };
    } catch (e) {
      console.warn('Could not initialize Crypto Web Worker, falling back to main thread', e);
      this.worker = null;
    }
  }

  /**
   * Fallback implementation executed on main thread if Web Worker is unavailable.
   */
  private async fallbackSha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Offload SHA-256 hash calculation to the dedicated Web Worker.
   */
  public async sha256Hex(input: string): Promise<string> {
    if (!this.worker) {
      return this.fallbackSha256(input);
    }

    const id = `req_${++this.requestCounter}_${Date.now()}`;
    const request: CryptoWorkerRequest = {
      id,
      type: 'sha256',
      payload: input,
    };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          // Fallback on timeout
          this.fallbackSha256(input).then(resolve).catch(reject);
        }
      }, 5000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.worker!.postMessage(request);
    });
  }

  /**
   * Offload batch SHA-256 hash calculation to Web Worker.
   */
  public async sha256Batch(inputs: string[]): Promise<string[]> {
    if (!this.worker) {
      return Promise.all(inputs.map((i) => this.fallbackSha256(i)));
    }

    const id = `req_batch_${++this.requestCounter}_${Date.now()}`;
    const request: CryptoWorkerRequest = {
      id,
      type: 'sha256Batch',
      payload: inputs,
    };

    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          Promise.all(inputs.map((i) => this.fallbackSha256(i))).then(resolve).catch(reject);
        }
      }, 10000);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.worker!.postMessage(request);
    });
  }

  public terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

export const cryptoWorkerClient = new CryptoWorkerClient();
