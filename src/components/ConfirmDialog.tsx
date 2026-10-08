import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmDialogProps {
  title: string;
  description: string;
  /** Outline button; omit both for a one-button notice. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Filled "my trip" button. */
  primaryLabel: string;
  onPrimary: () => void;
  /** Closed via the X, overlay or Escape. */
  onDismiss: () => void;
}

/** The trip flow's confirm prompt (or one-button notice), mounted open. */
export function ConfirmDialog({
  title,
  description,
  secondaryLabel,
  onSecondary,
  primaryLabel,
  onPrimary,
  onDismiss,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="max-w-sm w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          {secondaryLabel && onSecondary && (
            <Button variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            onClick={onPrimary}
            className="bg-my-trip-background text-white hover:bg-my-trip-background/90"
          >
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
