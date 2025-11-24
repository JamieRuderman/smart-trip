import { Card, CardContent } from "@/components/ui/card";
import { TrainFront } from "lucide-react";

export function EmptyState() {
  return (
    <Card
      className="text-center py-12 max-w-4xl mx-auto border-0 shadow-none"
      role="status"
      aria-live="polite"
    >
      <CardContent className="space-y-4">
        <div className="flex justify-center items-center gap-4 text-muted-foreground mb-4">
          <TrainFront
            className="h-8 w-8 text-primary"
            aria-hidden="true"
            style={{ strokeWidth: 1.5 }}
          />
        </div>
        <h2 className="text-xl font-semibold">Select Your Route</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Choose your departure and destination stations above to see available
          train schedules.
        </p>
      </CardContent>
    </Card>
  );
}


