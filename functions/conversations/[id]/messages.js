import { proxyRequest } from '../../_utils/proxy';

export async function onRequest(context) {
  // Handles GET/POST /conversations/:id/messages via proxy while Cloudflare port is pending.
  return proxyRequest(context);
}
