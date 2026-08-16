import { enqueueWebhook } from '../workers/webhook';

export interface CommitmentEvent {
  eventId: string;
  commitmentId: string;
  eventType: 'CREATED' | 'ATTESTED' | 'DISPUTED' | 'RESOLVED';
  issuer: string;
  counterparty?: string;
  timestamp: string;
  data?: Record<string, any>;
}

export class IndexerListener {
  private webhookUrls: string[];

  constructor(webhookUrls: string[] = []) {
    this.webhookUrls = webhookUrls;
  }

  public addWebhookUrl(url: string): void {
    if (!this.webhookUrls.includes(url)) {
      this.webhookUrls.push(url);
    }
  }

  /**
   * Called by the Soroban event indexer when a commitment state change or ledger event occurs.
   * Pushes jobs asynchronously to the WebhookWorker queue instead of executing synchronous HTTP requests.
   * This guarantees the main indexer loop is NEVER blocked by external HTTP latency, timeouts, or failures.
   */
  public handleCommitmentUpdate(event: CommitmentEvent): void {
    const payload = {
      event: event.eventType,
      commitmentId: event.commitmentId,
      issuer: event.issuer,
      counterparty: event.counterparty,
      timestamp: event.timestamp,
      data: event.data || {}
    };

    // Asynchronously queue webhook delivery for each configured subscriber
    for (const url of this.webhookUrls) {
      enqueueWebhook(url, payload);
    }
  }
}

export const indexerListener = new IndexerListener();
