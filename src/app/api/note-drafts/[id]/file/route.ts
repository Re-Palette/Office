import { getConfig } from "@/server/runtime/config";
import { getDraft, readDraftFile } from "@/server/note-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The draft as a downloadable .md — the document the CEO opens. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (getConfig().mode === "demo") {
    return new Response("not_configured", { status: 503 });
  }

  const { id } = await params;
  const draft = getDraft(id);
  if (!draft) return new Response("not found", { status: 404 });

  return new Response(readDraftFile(draft), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // RFC 5987, so a Japanese filename survives the download intact. Named
      // by its date, so a folder of these sorts chronologically.
      "content-disposition": `attachment; filename="note-draft.md"; filename*=UTF-8''${encodeURIComponent(
        draft.file,
      )}`,
      "cache-control": "no-store",
    },
  });
}
