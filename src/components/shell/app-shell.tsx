"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { advanceSimulation, useCompany } from "@/lib/store";
import { CLOCK_INTERVAL, SIM_INTERVAL } from "@/lib/engine/simulator";
import { JOB_POLL_INTERVAL, LIVE_POLL_INTERVAL } from "@/lib/live";
import { readSession } from "@/lib/auth";
import { NotificationBanner } from "@/components/company/notifications";
import { LiveErrorBanner } from "@/components/company/runtime-badge";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { RightPanel } from "./right-panel";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  const hydrateDecisions = useCompany((s) => s.hydrateDecisions);
  const tick = useCompany((s) => s.tick);
  const runScheduledReports = useCompany((s) => s.runScheduledReports);
  const pokeScheduler = useCompany((s) => s.pokeScheduler);
  const detectRuntime = useCompany((s) => s.detectRuntime);
  const syncFromServer = useCompany((s) => s.syncFromServer);
  const mode = useCompany((s) => s.mode);

  /* Auth gate — replaced by a Supabase session listener in Phase 3. */
  useEffect(() => {
    if (readSession()) {
      setChecked(true);
    } else {
      router.replace("/login");
    }
  }, [router]);

  /* The side panel is an overlay below xl, so it starts closed on small screens. */
  useEffect(() => {
    if (window.matchMedia("(max-width: 1279px)").matches) {
      useCompany.setState({ rightPanelOpen: false });
    }
  }, []);

  /* Company clock, and the CEO's stored decisions replayed over the seed. */
  useEffect(() => {
    hydrateDecisions();
    const id = window.setInterval(tick, CLOCK_INTERVAL);
    return () => window.clearInterval(id);
  }, [hydrateDecisions, tick]);

  /* Does this deployment have a key? Decides live vs. demo. */
  useEffect(() => {
    void detectRuntime();
  }, [detectRuntime]);

  /* Mock agent activity stream — only when nothing real is running. */
  useEffect(() => {
    const id = window.setInterval(advanceSimulation, SIM_INTERVAL);
    return () => window.clearInterval(id);
  }, []);

  /* Live mode: follow what the AI employees are actually doing. */
  useEffect(() => {
    if (mode !== "live") return;
    const id = window.setInterval(() => void syncFromServer(), LIVE_POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, [mode, syncFromServer]);

  /* Scheduled jobs — the Daily Executive Report fires when the clock reaches it. */
  useEffect(() => {
    const id = window.setInterval(runScheduledReports, 15_000);
    return () => window.clearInterval(id);
  }, [runScheduledReports]);

  /*
   * Server-side jobs (the daily note article). A platform cron is the real
   * trigger; this covers running locally, where there is no cron. Jobs are
   * keyed by JST day, so ringing this every few minutes costs nothing.
   */
  useEffect(() => {
    if (mode !== "live") return;
    void pokeScheduler();
    const id = window.setInterval(() => void pokeScheduler(), JOB_POLL_INTERVAL);
    return () => window.clearInterval(id);
  }, [mode, pokeScheduler]);

  /* Close the mobile drawer on navigation. */
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="font-mono text-xs tracking-[0.3em] text-ink-ghost">FRIDAY</span>
          <span className="h-px w-24 animate-pulse bg-accent/40" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNavOpen(false)}
              className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              <Sidebar onNavigate={() => setNavOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <LiveErrorBanner />
        <NotificationBanner />
        <div className="flex min-h-0 flex-1">
          <main className="scroll-slim min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[1800px] px-4 py-5 lg:px-7 lg:py-7 2xl:max-w-[2100px]">
              {children}
            </div>
          </main>
          <RightPanel />
        </div>
      </div>
    </div>
  );
}
