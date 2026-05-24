// Thin local mirrors of the SPA's Card / SectionCard / PillBadge so the
// SEO templates can share the SPA's visual language without importing the
// real SPA components (which don't carry @jsxRuntime pragmas and break
// tsx's classic-JSX transform at prerender time).
//
// Class strings are copy-of-truth from:
//   src/components/ui/card.tsx
//   src/components/ui/section-card.tsx
//   src/components/PillBadge.tsx
// If those change visually and the SEO pages should follow, update here.

import React, { type ReactNode } from "react";
// tsx (Node, classic JSX) needs React in scope at runtime. tsc with
// react-jsx wouldn't otherwise import this; void-ref to satisfy
// noUnusedLocals. The other SEO templates use the @jsxRuntime pragma
// instead, but for reasons I haven't isolated, the pragma isn't being
// applied to this file by esbuild — possibly something to do with the
// file being purely component definitions (no other top-level code).
void React;

const cx = (...parts: Array<string | false | undefined | null>): string =>
  parts.filter(Boolean).join(" ");

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-[1.5rem] sm:rounded-[2rem] border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cx(
        "border-0 shadow-none md:border max-w-4xl mx-auto w-full",
        className,
      )}
    >
      {children}
    </Card>
  );
}

export function CardHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col space-y-1.5 p-6", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={cx(
        "text-2xl font-semibold leading-none tracking-tight",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function CardContent({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx("p-6 pt-0", className)}>{children}</div>;
}

type PillColor = "ontime" | "neutral" | "muted";

export function PillBadge({
  label,
  color = "ontime",
}: {
  label: string;
  color?: PillColor;
}) {
  const colorClass =
    color === "ontime"
      ? "bg-primary text-primary-foreground border-transparent"
      : color === "neutral"
        ? "bg-foreground text-background border-transparent"
        : "bg-muted text-muted-foreground border-transparent";
  return (
    <span
      className={cx(
        "text-xs px-2 py-0.5 rounded-md font-medium whitespace-nowrap border",
        colorClass,
      )}
    >
      {label}
    </span>
  );
}
