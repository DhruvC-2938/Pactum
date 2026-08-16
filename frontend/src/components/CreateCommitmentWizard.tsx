import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import { sha256Hex } from '@/lib/hash'
import { stellarAddressSchema } from '@/lib/stellar'

export interface CreateCommitmentPayload {
  counterparty: string
  termsHash: string
  dueAt: number
}

interface CreateCommitmentWizardProps {
  onSubmit: (payload: CreateCommitmentPayload) => void
}

const commitmentFormSchema = z.object({
  counterparty: stellarAddressSchema,
  terms: z.string().min(1, 'Terms are required').max(2000, 'Terms must not exceed 2000 characters'),
  dueAt: z
    .string()
    .min(1, 'Due date is required')
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: 'Due date must be in the future',
    }),
})

type CommitmentFormValues = z.infer<typeof commitmentFormSchema>

const STEPS = [
  {
    title: 'Counterparty',
    subtitle: 'Who is the commitment owed to?',
    fields: ['counterparty'] as const,
  },
  {
    title: 'Terms & Conditions',
    subtitle: 'Describe the commitment in plain language',
    fields: ['terms'] as const,
  },
  {
    title: 'Deadline & Review',
    subtitle: 'Set the due date and confirm the details',
    fields: ['dueAt'] as const,
  },
]

const STEP_COUNT = STEPS.length

export default function CreateCommitmentWizard({ onSubmit }: CreateCommitmentWizardProps) {
  const [step, setStep] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<CreateCommitmentPayload | null>(null)

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    formState: { errors },
  } = useForm<CommitmentFormValues>({
    resolver: zodResolver(commitmentFormSchema),
    mode: 'onTouched',
    defaultValues: { counterparty: '', terms: '', dueAt: '' },
  })

  const values = watch()
  const dueAtMs = values.dueAt ? new Date(values.dueAt).getTime() : NaN
  const dueAtUnix = Number.isNaN(dueAtMs) ? null : Math.floor(dueAtMs / 1000)

  const handleNext = async () => {
    const valid = await trigger(STEPS[step].fields)
    if (valid) {
      setStep((current) => Math.min(current + 1, STEP_COUNT - 1))
    }
  }

  const handleBack = () => {
    setStep((current) => Math.max(current - 1, 0))
  }

  const handleFinalSubmit = handleSubmit(async (data) => {
    setSubmitting(true)
    try {
      const termsHash = await sha256Hex(data.terms)
      const payload: CreateCommitmentPayload = {
        counterparty: data.counterparty,
        termsHash,
        dueAt: Math.floor(new Date(data.dueAt).getTime() / 1000),
      }
      setSubmitted(payload)
      onSubmit(payload)
    } finally {
      setSubmitting(false)
    }
  })

  const isLastStep = step === STEP_COUNT - 1

  return (
    <div className="wizard">
      <ol className="wizard-steps">
        {STEPS.map((s, index) => {
          const state = index === step ? 'active' : index < step ? 'done' : ''
          return (
            <li key={s.title} className={`wizard-step ${state}`}>
              <span className="wizard-step-dot">{index < step ? '✓' : index + 1}</span>
              <span className="wizard-step-label">{s.title}</span>
            </li>
          )
        })}
      </ol>

      <div className="wizard-progress">
        <div
          className="wizard-progress-fill"
          style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
        ></div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{STEPS[step].title}</div>
        </div>
        <div className="card-body">
          {step === 0 && (
            <>
              <div className="inline-alert info">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="6" /><path d="M8 6v4M8 11.5v.5" />
                </svg>
                The issuer must authorize this transaction via their Stellar wallet. The commitment will be immediately visible on-chain.
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="wizard-counterparty">Counterparty Address</label>
                <input
                  type="text"
                  className={`form-input ${errors.counterparty ? 'has-error' : ''}`}
                  id="wizard-counterparty"
                  placeholder="G..."
                  autoComplete="off"
                  spellCheck="false"
                  {...register('counterparty')}
                />
                {errors.counterparty ? (
                  <div className="form-error">{errors.counterparty.message}</div>
                ) : (
                  <div className="form-hint">The Stellar address to whom the commitment is owed. Must be a valid G... address.</div>
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <div className="form-group">
              <label className="form-label" htmlFor="wizard-terms">Terms / Description</label>
              <textarea
                className={`form-textarea ${errors.terms ? 'has-error' : ''}`}
                id="wizard-terms"
                placeholder="Describe the commitment terms in plain language. This will be hashed (SHA-256) before being stored on-chain."
                {...register('terms')}
              ></textarea>
              {errors.terms ? (
                <div className="form-error">{errors.terms.message}</div>
              ) : (
                <div className="form-hint">Stored as a SHA-256 hash on-chain. Keep a copy of the original off-chain.</div>
              )}
            </div>
          )}

          {step === 2 && (
            <>
              <div className="form-group">
                <label className="form-label" htmlFor="wizard-dueat">Due Date</label>
                <input
                  type="datetime-local"
                  className={`form-input ${errors.dueAt ? 'has-error' : ''}`}
                  id="wizard-dueat"
                  {...register('dueAt')}
                />
                {errors.dueAt ? (
                  <div className="form-error">{errors.dueAt.message}</div>
                ) : (
                  <div className="form-hint">Must be a future date. Stored as a Unix timestamp on Stellar.</div>
                )}
              </div>

              <div className="wizard-review">
                <div className="wizard-review-title">Review Details</div>
                <div className="detail-panel">
                  <div className="detail-row">
                    <span className="detail-key">Counterparty</span>
                    <span className="detail-val mono">{values.counterparty || '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Terms</span>
                    <span className="detail-val">{values.terms || '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Due Date</span>
                    <span className="detail-val">
                      {values.dueAt ? new Date(values.dueAt).toLocaleString() : '—'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Unix Ts</span>
                    <span className="detail-val mono">{dueAtUnix ?? '—'}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {submitted && (
            <div className="inline-alert info" style={{ marginTop: '16px' }}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 8.5l3.5 3.5 7.5-7.5" />
              </svg>
              Commitment payload prepared: terms hashed (SHA-256) and due date converted to Unix time.
            </div>
          )}

          <div className="wizard-nav">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleBack}
              disabled={step === 0}
            >
              Back
            </button>

            {isLastStep ? (
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: '1' }}
                onClick={handleFinalSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <div className="spinner"></div>
                    <span className="btn-text">Hashing...</span>
                  </>
                ) : (
                  <span className="btn-text">Create Commitment</span>
                )}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" style={{ flex: '1' }} onClick={handleNext}>
                Continue
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}