import { z } from 'zod';

export const commitmentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title must not exceed 255 characters'),

  description: z.string().max(1000, 'Description must not exceed 1000 characters').optional(),

  amount: z.number().positive('Amount must be a positive number'),

  currency: z
    .string()
    .min(1, 'Currency is required if provided')
    .max(10, 'Currency code must not exceed 10 characters')
    .optional(),

  dueDate: z.string().datetime({ message: 'dueDate must be a valid ISO 8601 datetime string' }),

  partyA: z.string().min(1, 'partyA is required').max(255, 'partyA must not exceed 255 characters'),

  partyB: z
    .string()
    .min(1, 'partyB is required')
    .max(255, 'partyB must not exceed 255 characters')
    .optional(),

  status: z.enum(['pending', 'active', 'completed', 'disputed']).optional(),

  template: z.enum(['Freeform', 'RefundDeposit', 'SLAGuarantee', 'MilestoneCheckIn']).optional(),
});

export type CommitmentInput = z.infer<typeof commitmentSchema>;
