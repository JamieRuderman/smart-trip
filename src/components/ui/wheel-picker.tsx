import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const SETTLE_MS = 120;

interface WheelPickerProps {
  min: number;
  max: number;
  value: number;
  /** Called whenever the centred value changes. */
  onChange: (value: number) => void;
  format: (value: number) => string;
  ariaLabel: string;
  className?: string;
  /** Height of one row. */
  rowHeight?: number;
  /** Visible height; the rows above and below the value show in what's left. */
  height?: number;
  /** How far the rows next to the value are drawn in toward it, so a short
   *  wheel shows them whole, flush with its edges. */
  neighborOffset?: number;
  /** Up/down buttons beside the wheel that step it by one. */
  stepLabels?: { previous: string; next: string };
}

/**
 * A compact scroll wheel for picking a number: flick or
 * drag it, scroll it with a mouse or trackpad, tap a neighbouring row, or use
 * the arrow keys.
 */
export function WheelPicker({
  min,
  max,
  value,
  onChange,
  format,
  ariaLabel,
  className,
  rowHeight = 30,
  height = rowHeight * 3,
  neighborOffset = 0,
  stepLabels,
}: WheelPickerProps) {
  const spacer = (height - rowHeight) / 2;
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const target = useRef<number | null>(null);
  const clamped = Math.min(max, Math.max(min, value));
  const [centered, setCentered] = useState(clamped);

  const indexAt = (el: HTMLDivElement) =>
    Math.min(max - min, Math.max(0, Math.round(el.scrollTop / rowHeight)));

  useEffect(() => {
    const el = ref.current;
    if (!el || settleTimer.current != null) return;
    if (indexAt(el) !== clamped - min)
      el.scrollTop = (clamped - min) * rowHeight;
    setCentered(clamped);
    el.style.setProperty("--wheel-pos", String(clamped - min));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped, min, max, rowHeight]);

  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    },
    []
  );

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    const centeredNow = min + indexAt(el);
    setCentered(centeredNow);
    // A CSS variable, not state: every scroll frame would otherwise re-render every row.
    el.style.setProperty("--wheel-pos", String(el.scrollTop / rowHeight));
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      target.current = null;
      const index = indexAt(el);
      // Smooth scrolls can rest a couple of px past the snap point.
      if (el.scrollTop !== index * rowHeight) el.scrollTop = index * rowHeight;
      const next = min + index;
      if (next !== clamped) onChange(next);
    }, SETTLE_MS);
    // Reported as it changes, not on settle: a "Set" tapped before the wheel
    // settles otherwise saves the previous value.
    if (centeredNow !== clamped) onChange(centeredNow);
  };

  const scrollToValue = useCallback(
    (next: number) => {
      const el = ref.current;
      if (!el) return;
      const value = Math.min(max, Math.max(min, next));
      const top = (value - min) * rowHeight;
      // Already there: no scroll event will come to settle and clear it.
      target.current = el.scrollTop === top ? null : value;
      el.scrollTo({ top, behavior: "smooth" });
    },
    [min, max, rowHeight]
  );

  // A step taken mid-scroll starts from where the wheel is heading: `centered`
  // still holds the old value until the smooth scroll passes halfway.
  const stepBy = (delta: number) =>
    scrollToValue((target.current ?? centered) + delta);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowDown"
        ? -1
        : e.key === "PageUp"
        ? 5
        : e.key === "PageDown"
        ? -5
        : 0;
    if (step === 0) return;
    e.preventDefault();
    stepBy(step);
  };

  const values = [...Array(max - min + 1).keys()].map((i) => min + i);

  return (
    <div className={cn("flex shrink-0 items-center gap-3", className)}>
      <div className="relative min-w-0 flex-1" style={{ height }}>
        <div
          className="pointer-events-none absolute inset-x-0 rounded-md bg-white/20"
          style={{ top: spacer, height: rowHeight }}
          aria-hidden="true"
        />
        <div
          ref={ref}
          role="spinbutton"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={centered}
          aria-valuetext={format(centered)}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          style={{
            maskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, black 16%, black 84%, transparent)",
          }}
          className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-white [&::-webkit-scrollbar]:hidden"
        >
          <div style={{ height: spacer }} aria-hidden="true" />
          {values.map((v) => (
            <div
              key={v}
              onClick={() => scrollToValue(v)}
              className={cn(
                "flex snap-center items-center justify-center leading-none tabular-nums transition-[font-size,opacity] select-none",
                v === centered
                  ? "text-base font-semibold"
                  : "cursor-pointer text-xs opacity-70"
              )}
              style={{ height: rowHeight }}
              aria-hidden="true"
            >
              <span
                className="inline-block"
                style={
                  neighborOffset
                    ? {
                        transform: `translateY(calc(clamp(-1, ${
                          v - min
                        } - var(--wheel-pos), 1) * ${-neighborOffset}px))`,
                      }
                    : undefined
                }
              >
                {format(v)}
              </span>
            </div>
          ))}
          <div style={{ height: spacer }} aria-hidden="true" />
        </div>
      </div>
      {stepLabels && (
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => stepBy(1)}
            disabled={centered >= max}
            className="flex h-5 w-6 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-30"
            aria-label={stepLabels.next}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => stepBy(-1)}
            disabled={centered <= min}
            className="flex h-5 w-6 items-center justify-center rounded text-white hover:bg-white/15 disabled:opacity-30"
            aria-label={stepLabels.previous}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
