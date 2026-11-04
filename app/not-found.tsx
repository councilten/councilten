import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="wrap" style={{ padding: "120px 24px" }}>
        <span className="label">404</span>
        <h1 className="h2" style={{ marginTop: 14 }}>No seat at this address.</h1>
        <p className="sec-sub">The page moved or never existed. <Link href="/">Back to Council</Link> or read the <Link href="/docs">docs</Link>.</p>
      </main>
      <Footer />
    </>
  );
}
