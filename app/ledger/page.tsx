import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getLedger } from "@/lib/token";

export const metadata: Metadata = { title: "Ledger", description: "The Council token, read from Solana: supply, authorities, largest holders and burns." };
export const revalidate = 120;

const n = (x: number, d = 0) => x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;

export default async function Ledger() {
  const l = await getLedger();
  return (
    <>
      <Header current="ledger" />
      <main id="main" className="wrap">
        <div className="page-head">
          <span className="label">Ledger · read from Solana</span>
          <h1 style={{ marginTop: 14 }}>Every figure, from the chain.</h1>
          <p className="sec-sub">Supply, authorities, the largest holders and every burn of the Council mint. Nothing here is typed by hand; each line links to its account or transaction.</p>
        </div>

        {l.state === "unset" && (
          <div className="empty">
            <span className="label">Token CA · Solana</span>
            <h2 style={{ marginTop: 10 }}>The mint is not live yet.</h2>
            <p>The contract address is published on this site and on X the moment it goes live, nowhere else first. This page fills itself in from that moment.</p>
          </div>
        )}

        {l.state === "unavailable" && (
          <div className="empty">
            <h2>The chain is not answering right now.</h2>
            <p>Mint <code>{l.mint}</code>. The RPC returned: {l.error}. The page retries on its own every two minutes.</p>
          </div>
        )}

        {l.state === "live" && (
          <>
            <div className="stats">
              <div className="stat"><span className="label">Supply</span><div className="v num">{n(l.supply!)}</div></div>
              <div className="stat"><span className="label">Burned · recent</span><div className="v num">{n(l.burned!)}</div></div>
              <div className="stat"><span className="label">Top 10 hold</span><div className="v num">{l.top10Pct!.toFixed(2)}%</div></div>
              <div className="stat"><span className="label">Mint authority</span><div className="v" style={{ fontSize: 22 }}>{l.mintAuthority ? short(l.mintAuthority) : "None"}</div></div>
            </div>

            <h2 className="h2" style={{ fontSize: 28, marginBottom: 16 }}>Largest holders</h2>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th className="r">#</th><th>owner</th><th className="r">amount</th><th className="r">share</th></tr></thead>
                <tbody>
                  {l.top!.map((h, i) => (
                    <tr key={h.owner + i}>
                      <td className="r num">{i + 1}</td>
                      <td><a href={`https://solscan.io/account/${h.owner}`} rel="noopener">{h.owner}</a></td>
                      <td className="r num">{n(h.amount)}</td>
                      <td className="r num">{h.pct.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="h2" style={{ fontSize: 28, margin: "48px 0 16px" }}>Burns</h2>
            {l.burns!.length ? (
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead><tr><th>time · UTC</th><th className="r">amount</th><th>signature</th></tr></thead>
                  <tbody>
                    {l.burns!.map((b) => (
                      <tr key={b.signature}>
                        <td className="num">{b.time ? new Date(b.time * 1000).toISOString().slice(0, 16).replace("T", " ") : "—"}</td>
                        <td className="r num">{n(b.amount)}</td>
                        <td><a href={`https://solscan.io/tx/${b.signature}`} rel="noopener">{short(b.signature)}</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No burns in the mint&apos;s last 25 transactions.</p>
            )}
            <p className="tbl-meta num">Mint {l.mint} · {l.program?.startsWith("Tokenz") ? "Token-2022" : "SPL Token"} · slot {l.slot?.toLocaleString("en-US")}</p>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
