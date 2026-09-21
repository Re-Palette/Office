/**
 * Company clock.
 *
 * Seed data is expressed as offsets from a fixed reference instant so that the
 * server and the client render identical markup. Once mounted, the store ticks
 * this clock forward in real time and the simulator appends live events on top.
 */
export const SEED_NOW = Date.UTC(2026, 8, 21, 7, 42, 0); // 2026-09-21 16:42 JST

export const TZ = "Asia/Tokyo";

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});

const clockFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: TZ,
});

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: TZ,
});

export const minutes = (n: number) => n * 60_000;
export const hours = (n: number) => n * 3_600_000;
export const days = (n: number) => n * 86_400_000;

/** Offset helper used throughout the seed data: `ago(minutes(8))`. */
export const ago = (ms: number) => SEED_NOW - ms;
export const ahead = (ms: number) => SEED_NOW + ms;

export const formatTime = (at: number) => timeFmt.format(at);
export const formatClock = (at: number) => clockFmt.format(at);
export const formatDate = (at: number) => dateFmt.format(at);
export const formatDay = (at: number) => dayFmt.format(at);

export function formatRelative(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  if (delta < 45_000) return "just now";
  const m = Math.round(delta / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatCountdown(at: number, now: number): string {
  const delta = at - now;
  if (delta <= 0) return "overdue";
  const h = Math.floor(delta / 3_600_000);
  if (h < 24) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

export function greeting(at: number): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: TZ }).format(at),
  );
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
