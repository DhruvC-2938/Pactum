import { toast } from "sonner";
import { PendingToast, SuccessToast, ErrorToast } from "../components/toast/ToastElements";

export type TxToastId = string | number;

export interface TxSuccessOptions {
  message?: string;
  explorerUrl: string;
}

export interface TxErrorOptions {
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
        <SuccessToast
          message={message}
          explorerUrl={explorerUrl}
          onDismiss={() => toast.dismiss(t)}
        />
      ),
      { id, duration: 6000 }
    );
  },

  error(id: TxToastId | undefined, options: TxErrorOptions): TxToastId {
    const reason = options.reason;

    return toast.custom(
      (t) => (
        <ErrorToast
          reason={reason}
          onDismiss={() => toast.dismiss(t)}
        />
      ),
      { id, duration: 8000 }
    );
  },

  dismiss(id: TxToastId) {
    toast.dismiss(id);
  },
};
