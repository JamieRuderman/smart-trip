import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const SETTLE_MS = 120;

interface WheelPickerProps {
  min: number;
  max: number;
  value: number;
  /** Called once the wheel comes to rest on a new value. */
  onChange: (value: number) => void;
  format: (value: number) => string;
  ariaLabel: string;
  ariaValueText?: string;
  className?: string;
  /** Height of one row. */
  rowHeight?: number;
  /** Visible height; the rows above and below the value show in what's left. */
  height?: number;
}

/**
 * A compact scroll wheel (three rows tall) for picking a number: flick or
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
  ariaValueText,
  className,
  rowHeight = 30,
  height = rowHeight * 3,
}: WheelPickerProps) {
  const spacer = (height - rowHeight) / 2;
  const ref = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | null>(null);
  const clamped = Math.min(max, Math.max(min, value));
  const [centered, setCentered] = useState(clamped);

  const indexAt = (el: HTMLDivElement) =>
    Math.min(max - min, Math.max(0, Math.round(el.scrollTop / rowHeight)));

  useEffect(() => {
    const el = ref.current;
    if (!el || settleTimer.current != null) return;
    if (indexAt(el) !== clamped - min) el.scrollTop = (clamped - min) * rowHeight;
    setCentered(clamped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clamped, min, max, rowHeight]);

  useEffect(
    () => () => {
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  const handleScroll = () => {
    const el = ref.current;
    if (!el) return;
    setCentered(min + indexAt(el));
    if (settleTimer.current != null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      const next = min + indexAt(el);
      if (next !== clamped) onChange(next);
    }, SETTLE_MS);
  };

  const scrollToValue = useCallback(
    (next: number) => {
      ref.current?.scrollTo({
        top: (Math.min(max, Math.max(min, next)) - min) * rowHeight,
        behavior: "smooth",
      });
    },
    [min, max, rowHeight],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : e.key === "PageUp" ? -5 : e.key === "PageDown" ? 5 : 0;
    if (step === 0) return;
    e.preventDefault();
    scrollToValue(centered + step);
  };

  const values = [...Array(max - min + 1).keys()].map((i) => min + i);

  return (
    <div className={cn("relative shrink-0", className)} style={{ height: height }}>
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
        aria-valuetext={ariaValueText ?? format(centered)}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        className="relative h-full snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-white [&::-webkit-scrollbar]:hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
        }}
      >
        <div style={{ height: spacer }} aria-hidden="true" />
        {values.map((v) => (
          <div
            key={v}
            onClick={() => scrollToValue(v)}
            className={cn(
              "flex snap-center items-center justify-center tabular-nums transition-[font-size,opacity] select-none",
              v === centered
                ? "text-base font-semibold"
                : "cursor-pointer text-sm opacity-60",
            )}
            style={{ height: rowHeight }}
            aria-hidden="true"
          >
            {format(v)}
          </div>
        ))}
        <div style={{ height: spacer }} aria-hidden="true" />
      </div>
    </div>
  );
}
