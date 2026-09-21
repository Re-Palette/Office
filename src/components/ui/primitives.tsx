"use client";

import Link from "next/link";
import * as React from "react";
import { cn, initials } from "@/lib/utils";
import { AGENT_STATUS } from "@/lib/status";
import type { AgentStatus } from "@/lib/types";

/* ── Panel ─────────────────────────────────────────────────────────────────── */

export function Panel({
  className,
  children,
  flush,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-hairline bg-surface/70 shadow-panel backdrop-blur-xl",
        flush && "p-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  live,
  action,
  hint,
  className,
}: {
  title: string;
  live?: boolean;
  action?: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-hairline px-5 py-3.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {live && <LiveDot />}
        <h2 className="label text-ink-muted">{title}</h2>
        {hint && <span className="truncate text-2xs text-ink-ghost">{hint}</span>}
      </div>
      {action}
    </div>
  );
}

export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex h-1.5 w-1.5", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live opacity-70" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
    </span>
  );
}

/* ── Section title ─────────────────────────────────────────────────────────── */

export function SectionTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <h3 className={cn("label", className)}>{children}</h3>;
}

/* ── Button ────────────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "ghost" | "outline" | "danger" | "success" | "subtle";
type ButtonSize = "sm" | "md" | "xs";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-soft shadow-[0_6px_20px_-8px_rgba(108,124,255,0.8)]",
  success: "bg-live/12 text-live hover:bg-live/20 border border-live/25",
  danger: "bg-danger/10 text-danger hover:bg-danger/18 border border-danger/25",
  outline: "border border-hairline-strong text-ink-muted hover:bg-white/5 hover:text-ink",
  ghost: "text-ink-faint hover:bg-white/5 hover:text-ink",
  subtle: "bg-white/[0.04] text-ink-muted hover:bg-white/[0.08] hover:text-ink",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-2xs gap-1.5",
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button({ className, variant = "subtle", size = "sm", ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        "disabled:cursor-not-allowed disabled:opacity-40",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...props}
    />
  );
});

/* ── Chip / Badge ──────────────────────────────────────────────────────────── */

export function Chip({
  children,
  className,
  mono = true,
}: {
  children: React.ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-2xs font-medium",
        mono && "font-mono uppercase tracking-wider",
        "bg-white/5 text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── Status pill ───────────────────────────────────────────────────────────── */

export function StatusPill({
  status,
  className,
  showLabel = true,
}: {
  status: AgentStatus;
  className?: string;
  showLabel?: boolean;
}) {
  const meta = AGENT_STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-medium",
        meta.chip,
        className,
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          meta.dot,
          meta.pulse && "animate-pulse-ring",
        )}
      />
      {showLabel && meta.label}
    </span>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  accent,
  size = "md",
  status,
  className,
}: {
  name: string;
  accent: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  status?: AgentStatus;
  className?: string;
}) {
  const dims = {
    xs: "h-5 w-5 text-[8px]",
    sm: "h-7 w-7 text-[9px]",
    md: "h-9 w-9 text-[10px]",
    lg: "h-12 w-12 text-xs",
    xl: "h-16 w-16 text-base",
  }[size];

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-mono font-semibold tracking-wider",
          dims,
        )}
        style={{
          background: `linear-gradient(140deg, ${accent}2E, ${accent}0F)`,
          color: accent,
          boxShadow: `inset 0 0 0 1px ${accent}33`,
        }}
      >
        {initials(name)}
      </span>
      {status && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface",
            AGENT_STATUS[status].dot,
            AGENT_STATUS[status].pulse && "animate-pulse-ring",
          )}
        />
      )}
    </span>
  );
}

/* ── Progress ──────────────────────────────────────────────────────────────── */

export function Progress({
  value,
  className,
  tone = "accent",
}: {
  value: number;
  className?: string;
  tone?: "accent" | "live" | "warn" | "danger" | "neutral";
}) {
  const bar = {
    accent: "bg-accent",
    live: "bg-live",
    warn: "bg-warn",
    danger: "bg-danger",
    neutral: "bg-ink-ghost",
  }[tone];

  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-700 ease-out", bar)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

/* ── Metric ────────────────────────────────────────────────────────────────── */

export function Metric({
  label,
  value,
  sub,
  delta,
  positive,
  className,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  delta?: string;
  positive?: boolean;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "num text-2xl font-semibold leading-none tracking-tight",
            accent ? "text-accent-soft" : "text-ink",
          )}
        >
          {value}
        </span>
        {delta && (
          <span
            className={cn(
              "num text-2xs font-medium",
              positive === false ? "text-danger" : "text-live",
            )}
          >
            {delta}
          </span>
        )}
      </div>
      {sub && <span className="text-2xs text-ink-faint">{sub}</span>}
    </div>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────────── */

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
      <p className="text-sm text-ink-muted">{title}</p>
      {hint && <p className="text-xs text-ink-ghost">{hint}</p>}
    </div>
  );
}

/* ── Row link ──────────────────────────────────────────────────────────────── */

export function RowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group block transition-colors duration-150 hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ── Filter tabs ───────────────────────────────────────────────────────────── */

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            "rounded-lg px-2.5 py-1 font-mono text-2xs uppercase tracking-wider transition-colors duration-150",
            value === opt.id
              ? "bg-accent/15 text-accent-soft"
              : "text-ink-faint hover:bg-white/5 hover:text-ink-muted",
          )}
        >
          {opt.label}
          {opt.count !== undefined && (
            <span className="ml-1.5 text-ink-ghost">{opt.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
