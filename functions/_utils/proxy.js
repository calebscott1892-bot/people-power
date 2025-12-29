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

  if (!backendBase) {
    return new Response(JSON.stringify({ error: 'Backend unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
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

    const responseHeaders = new Headers(upstream.headers);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Upstream request failed', detail: String(err?.message || err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
