"""Browser test of /ask with a Wallet Standard test wallet: connect, pay, watch the council, then layout QA.
Usage: python3 test/ask_ui.py <site> <rpc> <user-address> <out-dir>"""
import json, sys
from playwright.sync_api import sync_playwright

site, rpc, addr, out = sys.argv[1:5]

WALLET = """
(() => {
  const RPC = %s, ADDR = %s;
  const icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#AB9FF2"/></svg>');
  const account = { address: ADDR, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: ['solana:signAndSendTransaction'] };
  const wallet = {
    version: '1.0.0', name: 'Test Wallet', icon, chains: ['solana:mainnet'], accounts: [account],
    features: {
      'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
      'standard:events': { version: '1.0.0', on: () => () => {} },
      'solana:signAndSendTransaction': { version: '1.0.0', supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: async (...inputs) => Promise.all(inputs.map(async (i) => {
          let b = ''; i.transaction.forEach((c) => (b += String.fromCharCode(c)));
          const r = await fetch(RPC + '/wallet/sign-and-send', { method: 'POST', body: JSON.stringify({ tx: btoa(b) }) }).then((r) => r.json());
          if (r.error) throw new Error(r.error);
          await new Promise((res) => setTimeout(res, 400));
          return { signature: Uint8Array.from(atob(r.signatureB64), (c) => c.charCodeAt(0)) };
        })) },
    },
  };
  const cb = (api) => api.register(wallet);
  window.addEventListener('wallet-standard:app-ready', (e) => cb(e.detail));
  window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: cb }));
})();
""" % (json.dumps(rpc), json.dumps(addr))

QA = """() => {
  const W = document.documentElement.clientWidth, bad = [];
  if (document.documentElement.scrollWidth > W + 1) bad.push('page scrolls sideways: ' + document.documentElement.scrollWidth);
  for (const el of document.querySelectorAll('main *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > W + 1 || r.left < -1) bad.push('outside viewport: ' + el.className + ' ' + (el.textContent||'').slice(0,30));
    if (el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') bad.push('clipped: ' + el.className + ' ' + el.textContent.slice(0,30));
  }
  return [...new Set(bad)].slice(0, 20);
}"""

errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, vp, scheme in [("desktop", {"width": 1440, "height": 1000}, "light"), ("desktop-dark", {"width": 1440, "height": 1000}, "dark"), ("mobile", {"width": 390, "height": 844}, "dark")]:
        ctx = b.new_context(viewport=vp, device_scale_factor=2 if name == "desktop" else 1, color_scheme=scheme)
        ctx.add_init_script(WALLET)
        pg = ctx.new_page()
        pg.on("console", lambda m: m.type == "error" and errors.append(f"{name} console: {m.text}"))
        pg.on("pageerror", lambda e: errors.append(f"{name} pageerror: {e}"))
        pg.goto(site + "/ask", wait_until="networkidle")
        pg.wait_for_timeout(600)
        pg.screenshot(path=f"{out}/ask-{name}-0.png", full_page=True)
        bad = pg.evaluate(QA)
        if bad: errors.append(f"{name} before: {bad}")
        pg.fill("textarea", "Should a treasury agent keep its USDC on Solana or bridge half to Base?")
        pg.get_by_role("button", name="Connect wallet").click()
        btn = pg.locator(".ask-go")
        btn.wait_for(state="visible")
        pg.wait_for_function("document.querySelector('.ask-go').textContent.startsWith('Pay ')", timeout=5000)
        label = btn.text_content()
        btn.click()
        pg.wait_for_selector(".ask-verdict:not(.ask-empty)", timeout=60000)
        pg.wait_for_function("document.querySelector('.ask-status').textContent.startsWith('Council closed')", timeout=20000)
        pg.locator(".ask-list li button").first.click()
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{out}/ask-{name}-1.png", full_page=True)
        bad = pg.evaluate(QA)
        if bad: errors.append(f"{name} after: {bad}")
        status = pg.text_content(".ask-status")
        verdict = pg.text_content(".ask-verdict p")
        receipt = pg.text_content(".ask-receipt")
        print(f"{name}: button '{label}' -> {status} | verdict '{verdict}' | {receipt}")
        ctx.close()
    # home page still clean with the new hero button and header link
    for name, vp in [("home-desktop", {"width": 1440, "height": 900}), ("home-mobile", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"{name} pageerror: {e}"))
        pg.goto(site + "/", wait_until="networkidle")
        bad = pg.evaluate(QA)
        if bad: errors.append(f"{name}: {bad}")
        pg.screenshot(path=f"{out}/{name}.png")
        ctx.close()
    b.close()

print("errors:", json.dumps(errors, indent=1) if errors else "none")
