import "server-only";

import { getConfig } from "./config";

/**
 * A setup check that answers the question a person would otherwise have to
 * answer with curl and their own copy of the key.
 *
 * Every step is reported with what it actually got back, because the failures
 * this catches look identical from outside: a key that resolves to `anon`
 * reads an empty table and is refused on write, which is indistinguishable
 * from a table that is simply empty. Nothing here echoes the key — only the
 * host, the kind of key, and what the server said.
 */

export interface Probe {
  step: string;
  ok: boolean;
  status: number | null;
  detail: string;
}

export interface Diagnosis {
  configured: boolean;
  /** Host only. The key never appears anywhere in this object. */
  host: string | null;
  keyKind: "secret" | "legacy-service-role" | "publishable-or-anon" | "unknown" | "missing";
  settingsProblem: string | null;
  probes: Probe[];
  verdict: string;
}

function classifyKey(key: string): Diagnosis["keyKind"] {
  if (!key) return "missing";
  if (key.startsWith("sb_secret_")) return "secret";
  if (key.startsWith("sb_publishable_")) return "publishable-or-anon";
  if (key.startsWith("eyJ")) {
    // A legacy key is a JWT whose payload names the role it carries.
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString("utf8"));
      if (claims.role === "service_role") return "legacy-service-role";
      if (claims.role === "anon" || claims.role === "authenticated") {
        return "publishable-or-anon";
      }
    } catch {
      // Not decodable — fall through.
    }
  }
  return "unknown";
}

async function probe(
  step: string,
  url: string,
  key: string,
  init: RequestInit,
): Promise<Probe & { body: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = await response.text().catch(() => "");
    return {
      step,
      ok: response.ok,
      status: response.status,
      detail: body.slice(0, 300) || "(empty body)",
      body,
    };
  } catch (error) {
    return {
      step,
      ok: false,
      status: null,
      detail: `接続できませんでした: ${(error as Error).message}`,
      body: "",
    };
  }
}

export async function diagnoseSupabase(): Promise<Diagnosis> {
  const { supabase } = getConfig();
  const keyKind = classifyKey(supabase.serviceKey);

  const base: Diagnosis = {
    configured: supabase.configured,
    host: supabase.url ? safeHost(supabase.url) : null,
    keyKind,
    settingsProblem: supabase.misconfigured,
    probes: [],
    verdict: "",
  };

  if (!supabase.configured) {
    return { ...base, verdict: "SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が設定されていません。" };
  }
  if (supabase.misconfigured) {
    return { ...base, verdict: supabase.misconfigured };
  }
  if (keyKind === "publishable-or-anon") {
    return {
      ...base,
      verdict:
        "publishable / anon キーが設定されています。行レベルセキュリティを迂回できないため、" +
        "読むと空・書くと拒否になります。Settings → API Keys の Secret keys（sb_secret_…）を使ってください。",
    };
  }

  const probes: Probe[] = [];

  // 1. Can the table be read at all?
  const read = await probe(
    "work_state を読む",
    `${supabase.url}/rest/v1/work_state?select=version&limit=1`,
    supabase.serviceKey,
    { method: "GET" },
  );
  probes.push(strip(read));

  if (!read.ok) {
    return {
      ...base,
      probes,
      verdict:
        read.status === 401 || read.status === 403
          ? `キーが拒否されました (${read.status})。値が正しいか、このプロジェクトのキーか確認してください。`
          : read.status === 404
            ? "work_state テーブルがありません。マイグレーションが別のプロジェクトに適用されている可能性があります。"
            : `読み取りに失敗しました: ${read.detail}`,
    };
  }

  // 2. Which role is the key actually resolving to? This is the one that
  //    matters and the one nothing else reveals: a key arriving as `anon`
  //    reads an empty table without error, exactly like a real empty table.
  const who = await probe(
    "キーのロールを確認",
    `${supabase.url}/rest/v1/rpc/friday_whoami`,
    supabase.serviceKey,
    { method: "POST", body: "{}" },
  );
  if (who.status !== 404) probes.push(strip(who));

  let role: string | null = null;
  try {
    role = (JSON.parse(who.body) as { current_user?: string }).current_user ?? null;
  } catch {
    // The probe function may not be installed; the write test still decides.
  }

  if (role && role !== "service_role") {
    return {
      ...base,
      probes,
      verdict:
        `キーが "${role}" として届いています（service_role ではありません）。` +
        "この権限では行レベルセキュリティを迂回できないため、読むと空・書くと拒否になります。",
    };
  }

  // 3. Can it write? This is the real test, and it is the work the app needs
  //    doing anyway — the row has to exist before anything can be saved.
  const write = await probe(
    "行を書き込めるか",
    `${supabase.url}/rest/v1/work_state`,
    supabase.serviceKey,
    {
      method: "POST",
      headers: { prefer: "return=representation,resolution=ignore-duplicates" },
      body: JSON.stringify({ id: "singleton", version: 0, state: { probe: true } }),
    },
  );
  probes.push(strip(write));

  if (!write.ok) {
    return {
      ...base,
      probes,
      verdict:
        /42501|row-level security/i.test(write.detail)
          ? "書き込みが行レベルセキュリティで拒否されました。キーが service_role として届いていません。"
          : `書き込みに失敗しました (${write.status}): ${write.detail}`,
    };
  }

  // Leave nothing behind: the app seeds the real row itself on next load.
  const clean = await probe(
    "テスト行を削除",
    `${supabase.url}/rest/v1/work_state?id=eq.singleton&version=eq.0`,
    supabase.serviceKey,
    { method: "DELETE" },
  );
  probes.push(strip(clean));

  return {
    ...base,
    probes,
    verdict: "Supabase への読み書きは正常です。会社の状態は保存されます。",
  };
}

/** The body can echo the request, so only the summary line is kept. */
function strip(p: Probe & { body: string }): Probe {
  return { step: p.step, ok: p.ok, status: p.status, detail: p.detail.slice(0, 200) };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(読めないURL)";
  }
}
