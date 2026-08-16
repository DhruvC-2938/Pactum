import {
  PactumEventType,
  ContractEventMap,
  EventCallback,
  RawSorobanEvent,
  decodeSorobanEvent
} from './events';

export interface PactumClientOptions {
  rpcUrl?: string;
  contractId?: string;
  networkPassphrase?: string;
}

export class PactumClient {
  private rpcUrl: string;
  private contractId: string;
  private networkPassphrase: string;
  private listeners: Map<PactumEventType, Set<EventCallback<any>>> = new Map();

  constructor(options: PactumClientOptions = {}) {
    this.rpcUrl = options.rpcUrl || 'https://soroban-testnet.stellar.org';
    this.contractId = options.contractId || '';
    this.networkPassphrase = options.networkPassphrase || 'Test SDF Network ; September 2015';
  }

  /**
   * Registers a strongly typed event listener for contract events.
   * TypeScript strictly enforces that the callback payload matches the specified eventType.
   *
   * @param eventType Event type to listen for ('created' | 'attested' | 'disputed' | 'resolved')
   * @param callback Callback function receiving the strongly typed event payload
   * @returns Unsubscribe cleanup function
   */
  public on<K extends PactumEventType>(
    eventType: K,
    callback: EventCallback<K>
  ): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(callback);

    // Return unsubscribe function
    return () => {
      this.off(eventType, callback);
    };
  }

  /**
   * Unsubscribes a callback from a specific event type.
   */
  public off<K extends PactumEventType>(
    eventType: K,
    callback: EventCallback<K>
  ): void {
    const callbackSet = this.listeners.get(eventType);
    if (callbackSet) {
      callbackSet.delete(callback);
    }
  }

  /**
   * Manually emits a typed event to all registered listeners.
   */
  public emit<K extends PactumEventType>(
    eventType: K,
    payload: ContractEventMap[K],
    rawEvent?: RawSorobanEvent
  ): void {
    const callbackSet = this.listeners.get(eventType);
    if (callbackSet) {
      callbackSet.forEach(cb => {
        try {
          cb(payload, rawEvent);
        } catch (error) {
          console.error(`[PactumClient] Error in '${eventType}' event callback:`, error);
        }
      });
    }
  }

  /**
   * Decodes a raw Soroban XDR / RPC event and dispatches it to registered typed listeners.
   *
   * @param rawEvent Raw Soroban event object containing topics and values
   * @returns True if decoded and dispatched, false otherwise
   */
  public handleRawEvent(rawEvent: RawSorobanEvent): boolean {
    const decoded = decodeSorobanEvent(rawEvent);
    if (!decoded) {
      return false;
    }

    this.emit(decoded.type, decoded.payload, rawEvent);
    return true;
  }

  /**
   * Removes all registered event listeners.
   */
  public removeAllListeners(eventType?: PactumEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Returns the count of registered listeners for an event type.
   */
  public listenerCount(eventType: PactumEventType): number {
    return this.listeners.get(eventType)?.size || 0;
  }
}
