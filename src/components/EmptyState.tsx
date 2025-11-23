import { Card, CardContent } from "@/components/ui/card";
import { MapPin, ArrowRight } from "lucide-react";

export function EmptyState() {
  return (
    <Card
      className="text-center py-12 max-w-4xl mx-auto"
      role="status"
      aria-live="polite"
    >
      <CardContent className="space-y-4">
        <div className="flex justify-center items-center gap-4 text-muted-foreground mb-4">
          <MapPin className="h-8 w-8" aria-hidden="true" />
          <ArrowRight className="h-6 w-6" aria-hidden="true" />
          <MapPin className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold">Select Your Route</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Choose your departure and destination stations above to see available train schedules.
        </p>
      </CardContent>
    </Card>
  );
}


