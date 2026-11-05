import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Ask, type AskSeat } from "@/components/Ask";
import { Logo } from "@/components/Logo";
import { getCatalog } from "@/lib/models";
import { hosted, readiness } from "@/lib/hosted/config";

export const metadata: Metadata = {
  title: "Ask the council",
  description: "Ask once and up to ten AI models answer, one judge writes the verdict. Pay one fixed price in USDC from your Solana wallet. No install, no account, no API key.",
};
export const revalidate = 600;

export default async function AskPage() {
  const cat = await getCatalog();
  const seats: AskSeat[] = cat.seats.map((s) => ({
    alias: s.alias,
    label: s.label,
    model: s.model ? { id: s.model.id, provider: s.model.provider, input: s.model.input, output: s.model.output, minimum: s.model.minimum ?? 0 } : null,
  }));
  const j = cat.seats.find((s) => s.alias === "claude" && s.model) ?? cat.seats.find((s) => s.model);
  const judge = j?.model ? { id: j.model.id, input: j.model.input, output: j.model.output, minimum: j.model.minimum ?? 0 } : null;
  const ready = readiness();

  return (
    <>
      <Header current="ask" />
      <main id="main">
        <section className="sec ask-sec">
          <div className="wrap">
            <div className="ask-head">
              <span className="label">Hosted council · pay once in USDC</span>
              <h1 className="h2 ask-title">Ask the council.</h1>
              <p className="sec-sub">
                Type a question, pick the seats, approve one payment. Every model answers on its own, the judge writes one
                verdict and names the point they split on. No install, no account, no API key.
              </p>
            </div>
            <Ask seats={seats} judge={judge} markupBps={hosted.markupBps} maxUsd={hosted.maxUsd} open={ready.ok} closedReason={ready.why} />
            <ol className="ask-how">
              <li><span className="num">01</span><div><b>Pay once <Logo k="usdc" size={16} /><Logo k="solana" size={14} /></b><p>One USDC transfer from your wallet to the council&apos;s wallet, at a fixed price you see first.</p></div></li>
              <li><span className="num">02</span><div><b>Every seat answers <Logo k="x402" size={13} /></b><p>The council&apos;s wallet pays each model over x402 on Solana. No seat sees another.</p></div></li>
              <li><span className="num">03</span><div><b>One verdict</b><p>The judge keeps what holds up, drops what doesn&apos;t, and tells you where they disagreed.</p></div></li>
            </ol>
            <p className="ask-kit">Running your own agent? The <Link href="/docs">kit</Link> does the same from your terminal or any MCP client, paid from your own wallet.</p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
