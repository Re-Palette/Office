import "server-only";

import { after } from "next/server";
import { withState } from "./store";

/**
 * Work that outlives the response.
 *
 * Three routes used to start an agent run and return immediately without
 * awaiting it — a CEO command, a report, and the resumption of a run the CEO
 * had just approved. On a long-lived server that works. On serverless it does
 * not: the instance is frozen the moment the response is sent, so the promise
 * stops mid-flight and never resumes. The dashboard showed "started", the
 * activity feed showed the first step, and then nothing — including, for an
 * approved action, an email the CEO had explicitly agreed to send.
 *
 * `after` is the platform's answer: it keeps the invocation alive until the
 * callback settles, still bounded by the route's maxDuration.
 *
 * The state has to be flushed again here. The request's own `withState`
 * flushed when the handler returned, which is before this work has done
 * anything — so without a second flush the run would complete correctly and
 * save nothing.
 */
export function background(label: string, work: () => Promise<unknown>): void {
  after(async () => {
    try {
      await withState(work);
    } catch (error) {
      // Nothing is waiting on this, so a throw here would be invisible.
      console.error(`[friday] background ${label} failed:`, error);
    }
  });
}
