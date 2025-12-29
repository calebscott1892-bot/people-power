export { ChatRoom } from './chatRoom.js';
export { EntityStore } from './entityStore.js';

/**
 * Minimal Cloudflare Workers entry.
 *
 * This is a scaffold to begin moving off the local/stub data layer and the Node server.
 * It intentionally exposes only a simple health route and a WebSocket upgrade path placeholder.
 */

export default {
  async fetch(request, _env, _ctx) {
    const env = _env;
    const url = new URL(request.url);

    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const json = (data, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('content-type', 'application/json');
      for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
      return new Response(JSON.stringify(data), { ...init, headers });
    };

    if (url.pathname === '/health') {
      return json({ ok: true, service: 'peoplepower-api' });
    }

    // Generic entity CRUD (backed by Durable Object storage for now).
    if (url.pathname.startsWith('/api/entities/')) {
      const doId = env.ENTITY_STORE.idFromName('global');
      const stub = env.ENTITY_STORE.get(doId);

      const path = url.pathname.replace('/api', '');
      const forwardedUrl = new URL(request.url);
      forwardedUrl.pathname = path;

      const forwarded = new Request(forwardedUrl.toString(), request);
      const res = await stub.fetch(forwarded);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    // Auth (placeholder; wire real auth later).
    if (url.pathname === '/api/auth/me') {
      return json(null);
    }

    // Integrations (placeholders; wire to real providers later).
    if (url.pathname === '/api/integrations/core/invoke-llm' && request.method === 'POST') {
      return json({
        text: '',
        choices: [{ message: { content: 'Stubbed response from Cloudflare Worker.' } }],
      });
    }

    if (url.pathname === '/api/integrations/core/upload-file' && request.method === 'POST') {
      return json({ file_url: null });
    }

    // Placeholder for chat upgrade. Real routing will be added during migration.
    if (url.pathname.startsWith('/ws/chat')) {
      return new Response('Not implemented', { status: 501 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
