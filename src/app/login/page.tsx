"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Fingerprint, ShieldCheck } from "lucide-react";
import { readSession, signIn } from "@/lib/auth";
import { AGENTS } from "@/lib/company/agents";
import { DEPARTMENTS } from "@/lib/company/departments";
import { Button } from "@/components/ui/primitives";

const PHASES = ["Verifying CEO identity", "Waking AI workforce", "Restoring company state"];

export default function LoginPage() {
  const router = useRouter();
  const [phase, setPhase] = useState(-1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (readSession()) router.replace("/");
  }, [router]);

  async function authenticate() {
    if (busy) return;
    setBusy(true);
    for (let i = 0; i < PHASES.length; i++) {
      setPhase(i);
      await new Promise((r) => setTimeout(r, 420));
    }
    signIn();
    router.push("/");
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div className="grid-noise pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/10 blur-[120px]"
        aria-hidden
      />

      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-[400px]"
      >
        <div className="mb-8 text-center">
          <div className="font-mono text-lg font-semibold tracking-[0.3em] text-ink">FRIDAY</div>
          <div className="mt-2 font-mono text-3xs uppercase tracking-[0.34em] text-ink-ghost">
            AI Company OS
          </div>
        </div>

        <div className="rounded-2xl border border-hairline bg-surface/80 p-6 shadow-lift backdrop-blur-2xl">
          <div className="flex items-center gap-2.5 border-b border-hairline pb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent-soft ring-1 ring-inset ring-accent/20">
              <Fingerprint className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <div className="text-sm font-medium text-ink">Executive Access</div>
              <div className="text-2xs text-ink-faint">CEO 専用のコンソールです</div>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-3 py-5">
            <Stat label="AI Employees" value={String(AGENTS.length)} />
            <Stat label="Departments" value={String(DEPARTMENTS.length)} />
            <Stat label="Human CEO" value="1" accent />
          </dl>

          <div className="rounded-xl border border-hairline bg-white/[0.02] px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent/30 to-accent/5 font-mono text-xs font-semibold text-accent-soft ring-1 ring-inset ring-accent/25">
                陽
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-ink">陽大</div>
                <div className="font-mono text-3xs uppercase tracking-[0.16em] text-ink-ghost">
                  CEO / Founder
                </div>
              </div>
            </div>
          </div>

          <Button
            variant="primary"
            size="md"
            onClick={authenticate}
            disabled={busy}
            className="mt-4 w-full"
          >
            {busy ? "Authenticating…" : "Enter Command Center"}
            {!busy && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />}
          </Button>

          <div className="mt-4 h-[58px]">
            {PHASES.map((p, i) => (
              <div
                key={p}
                className="flex items-center gap-2 py-0.5 transition-opacity duration-300"
                style={{ opacity: phase >= i ? 1 : 0.25 }}
              >
                <span
                  className={`h-1 w-1 rounded-full ${
                    phase >= i ? "bg-live" : "bg-ink-ghost"
                  }`}
                />
                <span className="font-mono text-3xs uppercase tracking-[0.12em] text-ink-faint">
                  {p}
                </span>
                {phase === i && busy && (
                  <span className="num text-3xs text-accent-soft">…</span>
                )}
                {phase > i && <span className="text-3xs text-live">ok</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-2 text-3xs text-ink-ghost">
          <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
          すべての外部アクションはCEO承認を必要とします
        </div>
      </motion.div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-3xs uppercase tracking-[0.14em] text-ink-ghost">{label}</dt>
      <dd
        className={`num mt-1 text-lg font-semibold leading-none ${
          accent ? "text-accent-soft" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
