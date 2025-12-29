export async function onRequest(context) {
  // Handles GET/POST /conversations/:id/messages
  // TODO: Extract and reuse shared logic from Node backend
  return new Response(JSON.stringify({ message: 'Not yet implemented' }), { status: 501 });
}
