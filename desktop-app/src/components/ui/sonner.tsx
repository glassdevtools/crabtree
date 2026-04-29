import { Check, X } from "lucide-react";
import type { ToasterProps } from "sonner";
import { Toaster as Sonner } from "sonner";

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
      position="bottom-right"
      {...props}
    />
  );
};

export { Toaster };
