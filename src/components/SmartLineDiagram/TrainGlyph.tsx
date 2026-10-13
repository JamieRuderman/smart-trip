import { ANIM, FONT_FAMILY, TOKEN } from "./tokens";

interface TrainGlyphProps {
  /** Ring, number, pointer and halo color. */
  accent: string;
  /** Train number shown in the disc. */
  label: string;
  /** Direction of travel, in degrees clockwise from up. */
  bearing: number;
  /** Disc fill — the surface the glyph sits on. */
  fill?: string;
  /** Breathe the halo; false draws it still. */
  pulse?: boolean;
  /** Dashed selection ring. */
  selected?: boolean;
  /** Small "my trip" dot, for when the accent isn't already the my-trip blue. */
  myTripBadge?: boolean;
}

/**
 * The line map's train marker drawing, centered on the origin in diagram
 * viewBox units: halo, direction pointer and numbered disc. Shared by the
 * diagram's {@link TrainMarker} and the My Trip position card, which scales it
 * into its own small `<svg>`.
 */
export function TrainGlyph({
  accent,
  label,
  bearing,
  fill = TOKEN.stationFill,
  pulse = true,
  selected = false,
  myTripBadge = false,
}: TrainGlyphProps) {
  return (
    <>
      <circle r={TOKEN.trainPulseR} fill={accent} opacity={TOKEN.trainPulseOpacity}>
        {pulse && (
          <>
            <animate
              attributeName="r"
              values={ANIM.trainPulseR}
              dur={ANIM.pulseDur}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values={ANIM.trainPulseOpacity}
              dur={ANIM.pulseDur}
              repeatCount="indefinite"
            />
          </>
        )}
      </circle>
      <g transform={`rotate(${bearing})`}>
        <path d={TOKEN.trainArrow} fill={accent} />
      </g>
      <circle
        r={TOKEN.trainInnerR}
        fill={fill}
        stroke={accent}
        strokeWidth={TOKEN.trainStroke}
      />
      <text
        y={TOKEN.trainTextBaseline}
        textAnchor="middle"
        fill={accent}
        style={{
          fontFamily: FONT_FAMILY,
          fontWeight: TOKEN.trainNumberWeight,
          fontSize: `${TOKEN.trainNumberSize}px`,
          letterSpacing: TOKEN.labelTracking,
        }}
      >
        {label}
      </text>
      {selected && (
        <circle
          r={TOKEN.trainSelectedR}
          fill="none"
          stroke={accent}
          strokeWidth={TOKEN.trainSelectedStroke}
          strokeDasharray={TOKEN.trainSelectedDash}
        />
      )}
      {myTripBadge && (
        // Small blue badge in the lower-right of the marker — used when the
        // accent stays gold/gray (delayed/canceled) so the "my trip" signal is
        // still visible.
        <circle
          cx={TOKEN.trainInnerR * 0.7}
          cy={TOKEN.trainInnerR * 0.7}
          r={TOKEN.userOnTrainR}
          fill={TOKEN.myTrip}
          stroke={fill}
          strokeWidth={TOKEN.userOnTrainStroke}
        />
      )}
    </>
  );
}
