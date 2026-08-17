import { z } from 'zod';

const hex32Regex = /^0x[0-9a-fA-F]{64}$/;

export const scoreDataSchema = z.object({
  score: z.number().int().min(0).max(100),
  fulfilledCount: z.number().int().min(0),
  lateCount: z.number().int().min(0),
  breachedCount: z.number().int().min(0),
  epoch: z.number().int().min(0),
  sourceLedgerSeq: z.number().int().min(1),
});

export const merkleProofNodeSchema = z.object({
  sibling: z.string().regex(hex32Regex, 'Sibling must be a 32-byte hex string (0x...)'),
  isRight: z.boolean(),
});

export const headerProofSchema = z.object({
  previousLedgerHash: z.string().regex(hex32Regex, 'previousLedgerHash must be a 32-byte hex string'),
  txSetResultHash: z.string().regex(hex32Regex, 'txSetResultHash must be a 32-byte hex string'),
  bucketListHash: z.string().regex(hex32Regex, 'bucketListHash must be a 32-byte hex string'),
  ledgerVersion: z.number().int().min(0),
});

export const pactumStateProofSchema = z.object({
  version: z.literal('1.0.0'),
  networkPassphrase: z.string().min(1, 'networkPassphrase is required'),
  ledgerSeq: z.number().int().min(1, 'ledgerSeq must be at least 1'),
  ledgerHeaderHash: z.string().regex(hex32Regex, 'ledgerHeaderHash must be a 32-byte hex string'),
  stateRootHash: z.string().regex(hex32Regex, 'stateRootHash must be a 32-byte hex string'),
  contractId: z.string().min(1, 'contractId is required'),
  stellarAddress: z.string().min(1, 'stellarAddress is required'),
  scoreData: scoreDataSchema,
  leafHash: z.string().regex(hex32Regex, 'leafHash must be a 32-byte hex string'),
  merkleProof: z.array(merkleProofNodeSchema),
  headerProof: headerProofSchema,
});

export type ScoreData = z.infer<typeof scoreDataSchema>;
export type MerkleProofNode = z.infer<typeof merkleProofNodeSchema>;
export type HeaderProof = z.infer<typeof headerProofSchema>;
export type PactumStateProof = z.infer<typeof pactumStateProofSchema>;

export interface VerificationResult {
  valid: boolean;
  score?: number;
  ledgerSeq?: number;
  stellarAddress?: string;
  contractId?: string;
  error?: string;
}
