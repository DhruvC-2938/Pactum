import { saveToDLQ, DLQEntry } from '../db/dlq';

export interface WebhookJob {
  id: string;
  url: string;
  payload: Record<string, any>;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  lastError?: string;
}

export type WebhookDispatcher = (url: string, payload: Record<string, any>) => Promise<boolean>;

export class WebhookWorker {
  private queue: WebhookJob[] = [];
  private isProcessing = false;
  private baseDelayMs: number;
  private maxAttempts: number;
  private dispatcher: WebhookDispatcher;

  constructor(options?: { baseDelayMs?: number; maxAttempts?: number; dispatcher?: WebhookDispatcher }) {
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.maxAttempts = options?.maxAttempts ?? 5;
    this.dispatcher = options?.dispatcher ?? this.defaultDispatcher;
  }

  private async defaultDispatcher(url: string, payload: Record<string, any>): Promise<boolean> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return response.ok;
    } catch (error: any) {
      throw new Error(error?.message || 'Network request failed');
    }
  }

  public setDispatcher(dispatcher: WebhookDispatcher): void {
    this.dispatcher = dispatcher;
  }

  /**
   * Calculate exponential backoff delay based on attempt number.
   * Attempt 1: baseDelay * 2^0 = baseDelay (1000ms)
   * Attempt 2: baseDelay * 2^1 = baseDelay * 2 (2000ms)
   * Attempt 3: baseDelay * 2^2 = baseDelay * 4 (4000ms)
   * Attempt 4: baseDelay * 2^3 = baseDelay * 8 (8000ms)
   * Attempt 5: Dumped to DLQ
   */
  public calculateBackoff(attempt: number): number {
    return this.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
  }

  /**
   * Enqueue a new webhook dispatch job asynchronously without blocking the main event loop.
   */
  public enqueue(url: string, payload: Record<string, any>): string {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const job: WebhookJob = {
      id: jobId,
      url,
      payload,
      attempts: 0,
      maxAttempts: this.maxAttempts
    };
    this.queue.push(job);

    // Asynchronously trigger processing without blocking caller
    setImmediate(() => {
      this.processQueue().catch(err => {
        console.error('[WebhookWorker] Unhandled error processing queue:', err);
      });
    });

    return jobId;
  }

  /**
   * Process pending jobs in the queue.
   */
  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      // Identify jobs ready for delivery/retry
      const readyJobs = this.queue.filter(job => !job.nextRetryAt || job.nextRetryAt <= now);

      for (const job of readyJobs) {
        job.attempts += 1;

        try {
          const success = await this.dispatcher(job.url, job.payload);
          if (success) {
            // Delivery succeeded, remove from queue
            this.removeFromQueue(job.id);
          } else {
            throw new Error('HTTP status non-ok');
          }
        } catch (error: any) {
          const errorMessage = error?.message || 'Delivery failed';
          job.lastError = errorMessage;

          if (job.attempts >= job.maxAttempts) {
            // Exceeded maximum retries (5 attempts) -> Dump payload into PostgreSQL DLQ table
            await saveToDLQ({
              url: job.url,
              payload: job.payload,
              attempts: job.attempts,
              lastError: errorMessage
            });
            this.removeFromQueue(job.id);
          } else {
            // Schedule exponential backoff retry
            const backoff = this.calculateBackoff(job.attempts);
            job.nextRetryAt = Date.now() + backoff;
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private removeFromQueue(jobId: string): void {
    this.queue = this.queue.filter(j => j.id !== jobId);
  }

  public getQueue(): WebhookJob[] {
    return [...this.queue];
  }

  public clearQueue(): void {
    this.queue = [];
  }
}

export const webhookWorker = new WebhookWorker();

export function enqueueWebhook(url: string, payload: Record<string, any>): string {
  return webhookWorker.enqueue(url, payload);
}
