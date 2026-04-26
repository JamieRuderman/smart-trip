import { ANIM, TOKEN } from "./tokens";

/**
 * Pulsing blue dot overlaying the station closest to the user. Matches the
 * train-marker pulse cadence so the two animations read as related.
 */
export function UserLocationMarker({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none">
      <circle
        r={TOKEN.userPulseR}
        fill={TOKEN.userLocation}
        opacity={TOKEN.userPulseOpacity}
      >
        <animate
          attributeName="r"
          values={ANIM.userPulseR}
          dur={ANIM.pulseDur}
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values={ANIM.userPulseOpacity}
          dur={ANIM.pulseDur}
          repeatCount="indefinite"
        />
      </circle>
      <circle
        r={TOKEN.userInnerR}
        fill={TOKEN.userLocation}
        stroke={TOKEN.stationFill}
        strokeWidth={TOKEN.userInnerStroke}
      />
    </g>
  );
}
