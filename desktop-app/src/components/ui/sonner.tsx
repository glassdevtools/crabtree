import { Check, X } from "lucide-react";
import type { ToasterProps } from "sonner";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";

const showSonnerWarningToast = sonnerToast.warning;

// Warning toasts stay visible by default because they usually need manual attention.
sonnerToast.warning = (message, data) => {
  return showSonnerWarningToast(message, {
    ...data,
    closeButton: data?.closeButton ?? true,
    duration: data?.duration ?? Infinity,
  });
};

const toast = sonnerToast;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      icons={{
        success: (
          <Check
            aria-hidden="true"
            className="toast-status-icon toast-status-icon-success"
            size={16}
            strokeWidth={2.25}
          />
        ),
        error: (
          <X
            aria-hidden="true"
            className="toast-status-icon toast-status-icon-error"
            size={16}
            strokeWidth={2.25}
          />
        ),
      }}
      position="top-center"
      {...props}
    />
  );
};

export { Toaster, toast };
