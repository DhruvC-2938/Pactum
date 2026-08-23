export type CommitmentStatus = 'Pending' | 'Fulfilled' | 'Late' | 'Breached' | 'Disputed';

export interface CommitmentCreatedPayload {
  id: bigint;
  issuer: string;
  counterparty: string;
}

export interface CommitmentAttestedPayload {
  id: bigint;
  status: CommitmentStatus;
}

export interface CommitmentDisputedPayload {
  id: bigint;
}

export interface DisputeResolvedPayload {
  id: bigint;
  finalOutcome: CommitmentStatus;
}

export interface ContractEventMap {
  created: CommitmentCreatedPayload;
  attested: CommitmentAttestedPayload;
  disputed: CommitmentDisputedPayload;
  resolved: DisputeResolvedPayload;
}

export type PactumEventType = keyof ContractEventMap;

export type EventCallback<T extends PactumEventType> = (
  payload: ContractEventMap[T],
  rawEvent?: RawSorobanEvent,
) => void;

export interface RawSorobanEvent {
  id?: string;
  type?: string;
  contractId?: string;
  topic: (string | any)[];
  value: any;
  ledger?: number;
  ledgerClosedAt?: string;
}

/**
 * Decodes raw Soroban RPC event topics and values into strongly typed JavaScript objects.
 * Handles both raw XDR/RPC response structures and pre-parsed native values.
 */
export function decodeSorobanEvent(
  rawEvent: RawSorobanEvent,
): { type: PactumEventType; payload: any } | null {
  if (!rawEvent || !rawEvent.topic || rawEvent.topic.length === 0) {
    return null;
  }

  const primaryTopic = String(rawEvent.topic[0]).toLowerCase();

  switch (primaryTopic) {
    case 'created': {
      // Topics: ["created", issuer, counterparty], Value: id
      const issuer = rawEvent.topic[1] ? String(rawEvent.topic[1]) : '';
      const counterparty = rawEvent.topic[2] ? String(rawEvent.topic[2]) : '';
      const id = parseBigInt(rawEvent.value);

      const payload: CommitmentCreatedPayload = { id, issuer, counterparty };
      return { type: 'created', payload };
    }

    case 'attested': {
      // Topics: ["attested", id], Value: status
      const id = parseBigInt(rawEvent.topic[1]);
      const status = parseStatus(rawEvent.value);

      const payload: CommitmentAttestedPayload = { id, status };
      return { type: 'attested', payload };
    }

    case 'disputed': {
      // Topics: ["disputed", id], Value: ()
      const id = parseBigInt(rawEvent.topic[1]);

      const payload: CommitmentDisputedPayload = { id };
      return { type: 'disputed', payload };
    }

    case 'resolved': {
      // Topics: ["resolved", id], Value: final_outcome
      const id = parseBigInt(rawEvent.topic[1]);
      const finalOutcome = parseStatus(rawEvent.value);

      const payload: DisputeResolvedPayload = { id, finalOutcome };
      return { type: 'resolved', payload };
    }

    default:
      return null;
  }
}

function parseBigInt(val: any): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(val);
  if (typeof val === 'string') return BigInt(val);
  if (val && typeof val === 'object' && val.toString) {
    try {
      return BigInt(val.toString());
    } catch {
      // Fallback
    }
  }
  return 0n;
}

function parseStatus(val: any): CommitmentStatus {
  if (typeof val === 'string') {
    const capitalized = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
    if (['Pending', 'Fulfilled', 'Late', 'Breached', 'Disputed'].includes(capitalized)) {
      return capitalized as CommitmentStatus;
    }
  }
  if (val && typeof val === 'object') {
    if (val.name) return parseStatus(val.name);
    if (val.value) return parseStatus(val.value);
  }
  return 'Pending';
}
