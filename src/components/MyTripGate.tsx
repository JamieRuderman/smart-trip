import type { ReactNode } from "react";
import { focusedTripKey, type FocusedTrip } from "@/lib/focusedTrip";
import { useFocusedTripLive } from "@/hooks/useFocusedTripLive";
import {
  useMyTripState,
  type MyTripInput,
  type MyTripState,
} from "@/hooks/useMyTrip";

interface MyTripGateProps {
  focusedTrip: FocusedTrip;
  currentTime: Date;
  children: (state: MyTripState) => ReactNode;
}

/**
 * Derives the focused trip's {@link MyTripState} (reconstructed trip + live
 * status + progress) and renders `children` with it — or nothing when the trip
 * has left the timetable (the provider's tick then clears the focus). Keyed
 * per trip, so switching trips resets per-trip state such as the alarm status's
 * sticky post-departure latch.
 */
export function MyTripGate(props: MyTripGateProps) {
  return <LiveGate key={focusedTripKey(props.focusedTrip)} {...props} />;
}

function LiveGate({ focusedTrip, currentTime, children }: MyTripGateProps) {
  const { trip, live, lastUpdated } = useFocusedTripLive(
    focusedTrip,
    currentTime.getTime(),
  );
  if (!trip) return null;
  return (
    <StateGate
      input={{ focusedTrip, trip, live, lastUpdated, currentTime }}
      render={children}
    />
  );
}

function StateGate({
  input,
  render,
}: {
  input: MyTripInput;
  render: (state: MyTripState) => ReactNode;
}) {
  const state = useMyTripState(input);
  return <>{render(state)}</>;
}
