export function resolveBackendBase(env = {}) {
  const candidates = [
    env.BACKEND_BASE_URL,
    env.API_BASE_URL,
    env.VITE_SERVER_URL,
    env.VITE_API_BASE_URL,
  ];
  for (const c of candidates) {
    const s = c ? String(c).trim() : '';
    if (s) return s;
  }
  return null;
}

export async function proxyRequest(context, { stripApiPrefix = false } = {}) {
  const { request, env } = context;
  const backendBase = resolveBackendBase(env);

  const applyNoStoreHeaders = (headers) => {
    const h = headers instanceof Headers ? headers : new Headers(headers || {});
    h.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    h.set('Pragma', 'no-cache');
    h.set('Expires', '0');
    const vary = h.get('Vary');
    if (!vary) h.set('Vary', 'Authorization');
    else if (!vary.split(',').map((s) => s.trim().toLowerCase()).includes('authorization')) {
      h.set('Vary', `${vary}, Authorization`);
    }
    return h;
  };

  if (!backendBase) {
    // TODO: Cloudflare port pending – keep using Node server locally or set BACKEND_BASE_URL.
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 503,
      headers: applyNoStoreHeaders({ 'Content-Type': 'application/json' }),
    });
  }

  const incoming = new URL(request.url);
  let targetPath = incoming.pathname || '/';
  if (stripApiPrefix && targetPath.startsWith('/api')) {
    targetPath = targetPath.slice(4) || '/';
  }
  const targetUrl = new URL(`${targetPath}${incoming.search || ''}`, backendBase);

  const method = request.method || 'GET';
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');

  let body;
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
    body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseHeaders = applyNoStoreHeaders(new Headers(upstream.headers));
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Upstream request failed' }), {
      status: 502,
      headers: applyNoStoreHeaders({ 'Content-Type': 'application/json' }),
    });
  }
}
