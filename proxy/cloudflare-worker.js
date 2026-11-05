// Optional: your own CORS proxy for Homebrew Vault, on Cloudflare Workers (free tier).
//
// Browsers only let a web app read another site if that site allows it, and
// free public proxies come and go. Deploy this once and URL imports work
// reliably:
//
//   1. https://dash.cloudflare.com → Workers & Pages → Create → "Hello World" worker.
//   2. Replace its code with this file and click Deploy.
//   3. (Recommended) Settings → Variables: add ALLOWED_ORIGIN = your app's origin,
//      e.g. https://<your-user>.github.io, so only your app can use the proxy.
//   4. In Homebrew Vault → ⚙ More → Import proxies, put this line first:
//        https://<your-worker>.<your-subdomain>.workers.dev/?url={url}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()) : ['*'];
    const allowOrigin = allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : '');
    const cors = {
      'Access-Control-Allow-Origin': allowOrigin || 'null',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      Vary: 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    if (!allowOrigin) return new Response('Origin not allowed', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Pass ?url=https://…', { status: 400, headers: cors }); }
    if (!/^https?:$/.test(url.protocol)) return new Response('Only http(s) URLs', { status: 400, headers: cors });

    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HomebrewVault/1.0; personal homebrew tracker)',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'text/html');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
