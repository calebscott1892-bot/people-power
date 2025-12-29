/**
 * Durable Object scaffold for real-time chat.
 *
 * Next steps:
 * - Define message protocol (join/leave/message/typing/read-receipts)
 * - Persist messages to Postgres (via Hyperdrive) and/or R2 for attachments
 * - Add auth (JWT/session) and rate limiting
 */

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(_request) {
    // This is intentionally a stub. WebSocket wiring will be added as part of migration.
    return new Response('Not implemented', { status: 501 });
  }
}
