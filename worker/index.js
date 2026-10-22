import { handleAI } from './api.mjs';

// The build embeds the frontend and its existing media in one Worker module.
const staticAssets = /*__ASSETS__*/ null;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ai') return handleAI(request);
    if (url.pathname.startsWith('/api/')) return Response.json({ error: { message: '接口不存在' } }, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const pathname = url.pathname === '/' || url.pathname === '/home' ? '/index.html' : url.pathname;
    const asset = staticAssets[pathname];
    if (!asset) return new Response('Not found', { status: 404 });
    const headers = {
      'content-type': asset.type,
      'cache-control': pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
      'etag': asset.etag,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-frameout-version': '4-api',
    };
    if (pathname.endsWith('.html')) headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https: data: blob:; form-action 'self'; base-uri 'self'; object-src 'none'";
    if (request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers });
    const body = request.method === 'HEAD' ? null : asset.binary ? Uint8Array.from(atob(asset.data), char => char.charCodeAt(0)) : asset.data;
    return new Response(body, { headers });
  },
};
