import type { ToasterProps } from "sonner";
import { Toaster as Sonner } from "sonner";

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      closeButton
      position="bottom-right"
      richColors
      {...props}
    />
  );
}

export { Toaster };
