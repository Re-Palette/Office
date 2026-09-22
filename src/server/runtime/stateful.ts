import "server-only";

import { withState } from "./store";

/**
 * Wraps a route handler so the company's state is loaded before it runs and
 * flushed after it returns.
 *
 * On a normal server this is nearly free — the state is already in memory. On
 * serverless it is what makes the app work at all: the instance handling this
 * request may never have seen the last one, so the state has to be fetched,
 * and anything the handler changed has to be written back before the function
 * is frozen.
 */
export function stateful<A extends unknown[]>(
  handler: (...args: A) => Promise<Response> | Response,
): (...args: A) => Promise<Response> {
  return (...args: A) => withState(() => handler(...args));
}
