import { createHash } from "node:crypto";
import { readiness } from "@/lib/hosted/config";
import { read, QuoteError } from "@/lib/hosted/quote";
import { hostedCouncil } from "@/lib/hosted/run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const isSig = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s);

/** Verify the visitor's payment and run the council, streaming one JSON event per line. */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }
  if (!readiness().ok) return Response.json({ error: "The table is not open yet." }, { status: 503 });
  const question = String(body?.question ?? "").trim();
  const signature = String(body?.signature ?? "");
  if (!isSig(signature)) return Response.json({ error: "Missing payment signature" }, { status: 400 });
  let claims;
  try {
    claims = read(String(body?.quote ?? ""));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: e instanceof QuoteError ? e.status : 400 });
  }
  if (createHash("sha256").update(question).digest("hex") !== claims.q) {
    return Response.json({ error: "The question does not match the quote" }, { status: 400 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const out = (e: unknown) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        for await (const e of hostedCouncil(claims, question, signature)) out(e);
      } catch (e: any) {
        console.error("run", e);
        out({ type: "error", message: "The council stopped unexpectedly. If you were charged and got no answer, you will be refunded." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
