import "server-only";

/**
 * Identifiers that stay unique across instances.
 *
 * Every id here used to be `prefix-{millis}-{counter}` with the counter
 * starting at zero in each process. On one server that is unique. On
 * serverless, several instances run at once and each starts its counter at
 * zero, so two of them generating an id in the same millisecond produce the
 * same one — and because the state merge unions records by id, the collision
 * does not error. It silently fuses two different reports, or two activity
 * events, into one.
 *
 * The fix is a per-process segment, drawn once. It costs four characters and
 * removes the whole class.
 */

const PROCESS = Math.random().toString(36).slice(2, 6);
let seq = 0;

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${PROCESS}${(seq++).toString(36)}`;
}

/** The per-process segment, so a test can prove two "instances" differ. */
export function processSegment(): string {
  return PROCESS;
}
