import { useSyncExternalStore } from 'react';
import type { CommitmentStatus } from '../lib/api';

export type CommitmentOutcomeName = 'fulfilled' | 'late' | 'breached';

export interface ContractEvent {
  type: 'created' | 'attested' | 'disputed' | 'resolved';
  commitmentId: string;
  sequence?: number; // from the backend stream
  issuer?: string;
  counterparty?: string;
  outcome?: CommitmentOutcomeName;
}

export interface RealtimeCommitmentState {
  status?: CommitmentStatus;
  outcome?: CommitmentStatus | null;
}

export interface StoreState {
  // commitmentId -> RealtimeCommitmentState
  realtimeCommitments: Record<string, RealtimeCommitmentState>;
  // track last processed sequence to deduplicate events
  lastProcessedSequence: number;
  
  applyEvent: (event: ContractEvent) => void;
  getRealtimeCommitment: (id: number | string) => RealtimeCommitmentState | undefined;
}

const mapOutcomeToStatus = (outcome?: CommitmentOutcomeName): CommitmentStatus | null => {
  switch (outcome) {
    case 'fulfilled': return 'Fulfilled';
    case 'late': return 'Late';
    case 'breached': return 'Breached';
    default: return null;
  }
};

let state: StoreState;
const listeners = new Set<() => void>();

function setState(updater: (prev: StoreState) => Partial<StoreState>) {
  state = { ...state, ...updater(state) };
  listeners.forEach((l) => l());
}

function getState(): StoreState {
  return state;
}

state = {
  realtimeCommitments: {},
  lastProcessedSequence: 0,
  
  applyEvent: (event) => setState((prev) => {
    if (event.sequence && event.sequence <= prev.lastProcessedSequence) {
      return prev;
    }
    
    const commitmentIdStr = event.commitmentId.toString();
    const current = prev.realtimeCommitments[commitmentIdStr] || {};
    
    let nextStatus = current.status;
    let nextOutcome = current.outcome;
    
    switch (event.type) {
      case 'created':
        nextStatus = 'Pending';
        break;
      case 'attested':
      case 'resolved':
        nextStatus = mapOutcomeToStatus(event.outcome) || 'Pending';
        nextOutcome = nextStatus;
        break;
      case 'disputed':
        nextStatus = 'Pending';
        break;
    }
    
    return {
      realtimeCommitments: {
        ...prev.realtimeCommitments,
        [commitmentIdStr]: {
          ...current,
          status: nextStatus,
          outcome: nextOutcome,
        }
      },
      lastProcessedSequence: event.sequence ? Math.max(prev.lastProcessedSequence, event.sequence) : prev.lastProcessedSequence,
    };
  }),

  getRealtimeCommitment: (id) => state.realtimeCommitments[id.toString()],
};

export function useStore<T = StoreState>(selector: (s: StoreState) => T = (s) => s as unknown as T): T {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => selector(state),
    () => selector(state),
  );
}

useStore.getState = getState;
