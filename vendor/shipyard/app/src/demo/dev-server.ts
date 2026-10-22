// demoDevServer is the page the live demo shows for a box's dev server,
// which it doesn't have: a plain, unbranded checkout page for the
// checkout-fix worktree, drawn in place so nothing loads from anywhere.
export function demoDevServer(url: string): string {
  const port = /^https?:\/\/(\d+)\./.exec(url)?.[1] ?? "3001";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:14px/1.5 system-ui,-apple-system,sans-serif;background:#f6f6f4;color:#222}
header{display:flex;align-items:center;gap:10px;padding:14px 28px;border-bottom:1px solid #e4e4e4;background:#fff}
header b{font-size:15px} header span{color:#888;font-size:13px}
main{padding:28px;max-width:560px} h1{font-size:20px;margin:0 0 4px} p{color:#666;margin:0 0 20px}
.card{background:#fff;border:1px solid #e4e4e4;border-radius:10px;padding:18px 20px;margin-bottom:14px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0}.row:last-child{border:0}
.price{font-size:26px;font-weight:600}.tag{display:inline-block;background:#eef6ee;color:#1f7a3a;border-radius:99px;padding:2px 10px;font-size:12px;margin-left:8px;vertical-align:middle}
small{color:#888}</style></head><body><header><b>Checkout</b><span>localhost:${port} · dev</span></header><main>
<h1>Order 1042</h1><p>3 items · ships in 2–3 days</p>
<div class="card"><div class="row"><span>Linen tote bag</span><span>€24.00</span></div><div class="row"><span>Ceramic mug × 2</span><span>€36.00</span></div><div class="row"><span>Shipping</span><span>€4.90</span></div></div>
<div class="card"><div class="price">€64.90 <small>total</small><span class="tag">Paid</span></div></div>
</main></body></html>`;
}
