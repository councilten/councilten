import Link from "next/link";
import { Mark, Wordmark } from "./Mark";
import { env } from "@/lib/site";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function Header({ current }: { current?: "docs" | "ledger" }) {
  return (
    <header className="hdr">
      <a className="skip" href="#main">Skip to content</a>
      <div className="wrap hdr-in">
        <Link href="/" className="brand" aria-label="Council home">
          <Mark />
          <Wordmark />
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/docs" className="keep" aria-current={current === "docs" ? "page" : undefined}>docs</Link>
          <Link href="/#models">models</Link>
          <Link href="/ledger" aria-current={current === "ledger" ? "page" : undefined}>ledger</Link>
          {env.githubUrl && <a href={env.githubUrl} rel="noopener">github</a>}
          {env.xUrl && <a href={env.xUrl} rel="noopener">x</a>}
        </nav>
        {env.mint ? (
          <a className="ca" href={`https://solscan.io/token/${env.mint}`} rel="noopener" title={env.mint}>
            <i aria-hidden="true" />
            <span className="num">{short(env.mint)}</span>
          </a>
        ) : (
          <span className="ca" title="The contract address is published here and on X the moment it goes live">
            <i aria-hidden="true" />CA at launch
          </span>
        )}
      </div>
    </header>
  );
}
