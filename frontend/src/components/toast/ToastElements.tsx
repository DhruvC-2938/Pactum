import { Loader2 } from "lucide-react";

export function PendingToast({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg bg-card border border-border p-3 shadow-md w-full max-w-[356px]">
      <Loader2 className="h-4 w-4 animate-spin shrink-0 text-foreground" />
      <span className="text-sm text-card-foreground">{message}</span>
    </div>
  );
}

export function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Dismiss notification"
      className="ml-auto shrink-0 text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
    >
      ×
    </button>
  );
}
