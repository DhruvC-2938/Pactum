import { create } from 'zustand';
import type { CommitmentStatus } from '@/lib/api';

export type CommitmentOutcomeName = 'fulfilled' | 'late' | 'breached';

export interface ContractEvent {
  type: 'created' | 'attested' | 'disputed' | 'resolved';
  commitmentId: string;
  sequence?: number; // from the backend stream
  issuer?: string;
  counterparty?: string;
  outcome?: CommitmentOutcomeName;
}

interface RealtimeCommitmentState {
  status?: CommitmentStatus;
  outcome?: CommitmentStatus | null;
}

interface StoreState {
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

export const useStore = create<StoreState>((set, get) => ({
  realtimeCommitments: {},
  lastProcessedSequence: 0,
  
  applyEvent: (event) => set((state) => {
    if (event.sequence && event.sequence <= state.lastProcessedSequence) {
      // Deduplicate old events or repeat events
      return state;
    }
    
    const commitmentIdStr = event.commitmentId.toString();
    const current = state.realtimeCommitments[commitmentIdStr] || {};
    
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
        nextStatus = 'Pending'; // 'Disputed' isn't explicitly in CommitmentStatus enum based on current UI, wait, api.ts says 'Pending' | 'Fulfilled' | 'Late' | 'Breached'
        // Actually, status could be something else if disputed, but we'll leave it
        break;
    }
    
    return {
      realtimeCommitments: {
        ...state.realtimeCommitments,
        [commitmentIdStr]: {
          ...current,
          status: nextStatus,
          outcome: nextOutcome,
        }
      },
      lastProcessedSequence: event.sequence ? Math.max(state.lastProcessedSequence, event.sequence) : state.lastProcessedSequence,
    };
  }),

  getRealtimeCommitment: (id) => get().realtimeCommitments[id.toString()],
}));
