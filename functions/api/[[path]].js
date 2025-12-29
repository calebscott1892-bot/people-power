import { proxyRequest } from '../_utils/proxy';

export async function onRequest(context) {
  // Cloudflare Pages Functions catch-all for /api/* routes.
  // Proxies to the configured backend origin while preserving all auth/safety logic there.
  return proxyRequest(context, { stripApiPrefix: true });
}
