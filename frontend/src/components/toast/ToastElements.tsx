import { Loader2, CheckCircle2, XCircle, X } from "lucide-react";

export function PendingToast({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-card border border-border p-3 shadow-md w-full max-w-[356px]">
      <Loader2 className="h-4 w-4 animate-spin shrink-0 text-foreground" />
      <span className="text-sm text-card-foreground">{message}</span>
    </div>
  );
}

export function SuccessToast({
  message,
  explorerUrl,
  onDismiss,
}: {
  message: string;
  explorerUrl: string;
  onDismiss: () => void;
}) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg bg-card border border-border p-3 shadow-md w-full max-w-[356px]">
      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-medium text-card-foreground">{message}</span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 transition-opacity w-fit"
        >
          View on Stellar Expert
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </div>
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

export function ErrorToast({
  reason,
  onDismiss,
}: {
  reason: string;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-card border border-destructive/40 p-3 shadow-md w-full max-w-[356px]">
      <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-sm font-medium text-card-foreground">Transaction failed</span>
        <span className="text-xs text-muted-foreground break-words">{reason}</span>
      </div>
      <DismissButton onClick={onDismiss} />
    </div>
  );
}

export function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss notification"
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex items-center justify-center"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
