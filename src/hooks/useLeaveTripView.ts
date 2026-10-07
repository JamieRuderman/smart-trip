import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { hasInAppHistory } from "@/lib/tripView";

/**
 * Leave the My Trip view: back to wherever the user came from (the schedule,
 * or the line map they tapped "Take this train" on), or — when the view was
 * the first page loaded, so there's no in-app history to pop — replace it with
 * the schedule so the back stack doesn't hold a dead trip page.
 */
export function useLeaveTripView(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (hasInAppHistory(location.key)) {
      navigate(-1);
    } else {
      navigate({ pathname: "/", search: location.search }, { replace: true });
    }
  }, [navigate, location.key, location.search]);
}
