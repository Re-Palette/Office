"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { advanceSimulation, useCompany } from "@/lib/store";
import { CLOCK_INTERVAL, SIM_INTERVAL } from "@/lib/engine/simulator";
import { readSession } from "@/lib/auth";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { RightPanel } from "./right-panel";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  const startClock = useCompany((s) => s.startClock);
  const tick = useCompany((s) => s.tick);

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

  /* Company clock. */
  useEffect(() => {
    startClock();
    const id = window.setInterval(tick, CLOCK_INTERVAL);
    return () => window.clearInterval(id);
  }, [startClock, tick]);

  /* Mock agent activity stream. */
  useEffect(() => {
    const id = window.setInterval(advanceSimulation, SIM_INTERVAL);
    return () => window.clearInterval(id);
  }, []);

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
