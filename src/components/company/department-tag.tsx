"use client";

import Link from "next/link";
import { DEPARTMENTS, DEPARTMENT_ACCENT } from "@/lib/company/departments";
import { cn } from "@/lib/utils";
import type { DepartmentId } from "@/lib/types";

/**
 * A department's identity: a colour mark plus its name in ink.
 *
 * The colour never carries the name on its own — coloured text at label sizes
 * is both harder to read and unusable for anyone who can't separate the hues.
 * Every department mark in the product goes through this component so the rule
 * holds everywhere.
 */
export function DepartmentTag({
  department,
  size = "sm",
  href,
  className,
  showName = true,
}: {
  department: DepartmentId;
  size?: "xs" | "sm" | "md";
  href?: string;
  className?: string;
  showName?: boolean;
}) {
  const meta = DEPARTMENTS.find((d) => d.id === department);
  const accent = DEPARTMENT_ACCENT[department];

  const text = {
    xs: "text-3xs",
    sm: "text-2xs",
    md: "text-xs",
  }[size];

  const swatch = {
    xs: "h-2 w-2",
    sm: "h-2.5 w-2.5",
    md: "h-3 w-3",
  }[size];

  const content = (
    <>
      <span
        className={cn("shrink-0 rounded-[3px]", swatch)}
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      {showName && (
        <span
          className={cn(
            "truncate font-mono font-medium uppercase tracking-label text-ink-muted",
            text,
          )}
        >
          {meta?.label ?? department}
        </span>
      )}
    </>
  );

  const shell = cn("inline-flex items-center gap-1.5", className);

  if (href) {
    return (
      <Link
        href={href}
        className={cn(shell, "transition-colors hover:[&>span:last-child]:text-ink")}
        title={meta?.name}
      >
        {content}
      </Link>
    );
  }

  return (
    <span className={shell} title={meta?.name}>
      {content}
    </span>
  );
}

/** Just the mark, for dense rows where the name is already on screen. */
export function DepartmentDot({
  department,
  className,
}: {
  department: DepartmentId;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", className)}
      style={{ backgroundColor: DEPARTMENT_ACCENT[department] }}
      aria-hidden
    />
  );
}
