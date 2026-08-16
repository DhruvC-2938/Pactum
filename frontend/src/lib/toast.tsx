import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { PendingToast, DismissButton } from "../components/toast/ToastElements";

export type TxToastId = string | number;

interface TxSuccessOptions {
  message?: string;
  explorerUrl: string;
}

interface TxErrorOptions {
  reason: string;
}

export const notify = {
  pending(message = "Waiting for signature..."): TxToastId {
    return toast.custom(() => <PendingToast message={message} />, {
      duration: Infinity,
    });
  },

  processing(id: TxToastId, message = "Transaction submitted to network..."): TxToastId {
    return toast.custom(() => <PendingToast message={message} />, {
      id,
      duration: Infinity,
    });
  },

  success(id: TxToastId, options: TxSuccessOptions): TxToastId {
    const message = options.message ?? "Commitment created successfully!";
    const explorerUrl = options.explorerUrl;

    return toast.custom(
      (t) => (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-card border border-border p-3 shadow-md w-full max-w-[356px]">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-medium text-card-foreground">{message}</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 transition-opacity w-fit">
              View on Stellar Expert
              <span className="sr-only"> (opens in new tab)</span>
            </a>
          </div>
          <DismissButton onClick={() => toast.dismiss(t)} />
        </div>
      ),
      { id, duration: 6000 }
    );
  },

  error(id: TxToastId | undefined, options: TxErrorOptions): TxToastId {
    const reason = options.reason;

    return toast.custom(
      (t) => (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-card border border-destructive/40 p-3 shadow-md w-full max-w-[356px]">
          <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0">
            <span className="text-sm font-medium text-card-foreground">Transaction failed</span>
            <span className="text-xs text-muted-foreground break-words">{reason}</span>
          </div>
          <DismissButton onClick={() => toast.dismiss(t)} />
        </div>
      ),
      { id, duration: 8000 }
    );
  },

  dismiss(id: TxToastId) {
    toast.dismiss(id);
  },
};
