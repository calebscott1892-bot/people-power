/**
 * Messages API client.
 *
 * Network-backed (Node server) endpoints (see Server/index.js):
 * - GET  /conversations?type=inbox|requests -> Conversation[]
 * - POST /conversations                    -> Conversation
 * - POST /conversations/:id/request        -> Conversation
 * - GET  /conversations/:id/messages       -> Message[]
 * - POST /conversations/:id/messages       -> Message
 * - POST /conversations/:id/read           -> { ok: true }
 * - POST /messages/:id/reactions           -> Message
 *
 * This module also supports a local fallback mode using `entities.*` (stub)
 * for environments where the backend is unavailable.
 *
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string[]} participant_emails
 * @property {boolean|null} is_request
 * @property {string|null} requester_email
 * @property {'pending'|'accepted'|'declined'|'blocked'|string|null} request_status
 * @property {string|null} blocked_by_email
 * @property {string|null} updated_at
 * @property {string|null} created_at
 * @property {string|null} last_message_body
 * @property {string|null} last_message_at
 * @property {number|null} unread_count
 *
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} conversation_id
 * @property {string} sender_email
 * @property {string} body
 * @property {string|null} created_at
 * @property {string[]|null} read_by
 * @property {Object|null} reactions
 */

import { getServerBaseUrl } from './serverBase';
import { entities } from '@/api/appClient';

const BASE_URL = getServerBaseUrl();

function normalizeId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

async function safeReadJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function authHeaders(accessToken) {
  const token = accessToken ? String(accessToken) : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function hasParticipant(conversation, email) {
  const me = normalizeEmail(email);
  const list = Array.isArray(conversation?.participant_emails) ? conversation.participant_emails : [];
  return list.map((e) => normalizeEmail(e)).includes(me);
}

async function localFetchConversations(myEmail) {
  const me = normalizeEmail(myEmail);
  if (!me) return [];
  const all = await entities.Conversation.list();
  const list = (Array.isArray(all) ? all : []).filter((c) => hasParticipant(c, me));
  return list.sort((a, b) => {
    const ta = a?.last_message_time ? new Date(a.last_message_time).getTime() : 0;
    const tb = b?.last_message_time ? new Date(b.last_message_time).getTime() : 0;
    return tb - ta;
  });
}

function normalizeFields(value) {
  if (!value) return null;
  const list = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)) : null;
}

function projectRecord(record, fields) {
  if (!fields) return record;
  const out = {};
  const want = new Set(['id', ...fields]);
  for (const key of want) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  return out;
}

async function localFetchConversationsPage(myEmail, { limit = 20, offset = 0, fields = null, type = null } = {}) {
  const list = await localFetchConversations(myEmail);
  const box = type ? String(type) : null;
  const filtered =
    box === 'requests'
      ? list.filter((c) => String(c?.request_status || '').toLowerCase() === 'pending')
      : box === 'inbox'
        ? list.filter((c) => {
            const status = String(c?.request_status || 'accepted').toLowerCase();
            return status !== 'pending' && status !== 'declined';
          })
        : list;

  const page = filtered.slice(offset, offset + limit);
  const wanted = normalizeFields(fields);
  return wanted ? page.map((c) => projectRecord(c, wanted)) : page;
}

async function localFindOrCreateConversation(myEmail, otherEmail) {
  const me = normalizeEmail(myEmail);
  const other = normalizeEmail(otherEmail);
  if (!me) throw new Error('Missing user email');
  if (!other) throw new Error('Recipient email is required');

  const existing = await localFetchConversations(me);
  const hit = existing.find((c) => {
    const parts = Array.isArray(c?.participant_emails) ? c.participant_emails.map(normalizeEmail) : [];
    return parts.includes(me) && parts.includes(other);
  });
  if (hit) return hit;

  return entities.Conversation.create({
    participant_emails: [me, other],
    request_status: 'pending',
    requester_email: me,
    last_message: '',
    last_message_sender: null,
    last_message_time: nowIso(),
    created_at: nowIso(),
  });
}

async function localFetchMessages(conversationId) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');
  const all = await entities.Message.list();
  const list = (Array.isArray(all) ? all : []).filter((m) => String(m?.conversation_id || '') === String(id));
  return list.sort((a, b) => {
    const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb;
  });
}

async function localFetchMessagesPage(conversationId, { limit = 20, offset = 0, fields = null } = {}) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');

  const wanted = normalizeFields(fields);

  // Newest-first paging (matches server behavior), so UI can load "older" pages.
  // Uses the enhanced stub filter signature: filter(where, sort, options).
  try {
    const page = await entities.Message.filter({ conversation_id: String(id) }, '-created_at', {
      limit,
      offset,
      fields: wanted,
    });
    return Array.isArray(page) ? page : [];
  } catch {
    // Back-compat fallback: list all, then slice.
    const all = await localFetchMessages(id);
    const sortedDesc = (Array.isArray(all) ? all : []).slice().sort((a, b) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    const slice = sortedDesc.slice(offset, offset + limit);
    return wanted ? slice.map((m) => projectRecord(m, wanted)) : slice;
  }
}

async function localSendMessage(myEmail, conversationId, bodyText) {
  const me = normalizeEmail(myEmail);
  const id = normalizeId(conversationId);
  if (!me) throw new Error('Missing user email');
  if (!id) throw new Error('Conversation ID is required');

  const convs = await entities.Conversation.list();
  const conversation = (Array.isArray(convs) ? convs : []).find((c) => String(c?.id) === String(id));
  if (!conversation) throw new Error('Conversation not found');

  const status = String(conversation?.request_status || '').toLowerCase();
  const requester = normalizeEmail(conversation?.requester_email);
  if (status === 'pending' && requester && requester !== me) {
    throw new Error('This is a message request. Accept to reply.');
  }

  const createdAt = nowIso();
  const message = await entities.Message.create({
    conversation_id: id,
    sender_email: me,
    body: String(bodyText ?? ''),
    created_at: createdAt,
    read_by: [me],
    reactions: {},
  });

  const last = String(bodyText ?? '');
  await entities.Conversation.update(id, {
    last_message: last.length > 160 ? `${last.slice(0, 160)}…` : last,
    last_message_sender: me,
    last_message_time: createdAt,
  });

  return message;
}

async function localMarkConversationRead(myEmail, conversationId) {
  const me = normalizeEmail(myEmail);
  const id = normalizeId(conversationId);
  if (!me) throw new Error('Missing user email');
  if (!id) throw new Error('Conversation ID is required');

  const messages = await localFetchMessages(id);
  await Promise.all(
    messages.map((m) => {
      const readBy = Array.isArray(m?.read_by) ? m.read_by.map(normalizeEmail) : [];
      if (readBy.includes(me)) return null;
      return entities.Message.update(m.id, { read_by: [...readBy, me] });
    })
  );

  return { ok: true };
}

async function localActOnConversationRequest(myEmail, conversationId, action) {
  const me = normalizeEmail(myEmail);
  const id = normalizeId(conversationId);
  if (!me) throw new Error('Missing user email');
  if (!id) throw new Error('Conversation ID is required');
  const act = String(action || '').toLowerCase();
  if (!['accept', 'decline'].includes(act)) throw new Error('Invalid action');

  const convs = await entities.Conversation.list();
  const conversation = (Array.isArray(convs) ? convs : []).find((c) => String(c?.id) === String(id));
  if (!conversation) throw new Error('Conversation not found');

  const requester = normalizeEmail(conversation?.requester_email);
  if (!requester || requester === me) {
    // requester can always manage their outgoing request; recipient can accept/decline
  }

  if (act === 'decline') {
    return entities.Conversation.update(id, { request_status: 'declined' });
  }

  return entities.Conversation.update(id, { request_status: 'accepted' });
}

async function localToggleReaction(myEmail, messageId, emoji) {
  const me = normalizeEmail(myEmail);
  const id = normalizeId(messageId);
  const e = String(emoji || '').trim();
  if (!me) throw new Error('Missing user email');
  if (!id) throw new Error('Message ID is required');
  if (!e) throw new Error('Emoji is required');

  const msgs = await entities.Message.list();
  const message = (Array.isArray(msgs) ? msgs : []).find((m) => String(m?.id) === String(id));
  if (!message) throw new Error('Message not found');

  const reactions = message?.reactions && typeof message.reactions === 'object' ? message.reactions : {};
  const current = Array.isArray(reactions?.[e]) ? reactions[e] : [];
  const normalized = current.map(normalizeEmail);
  const has = normalized.includes(me);
  const nextEmails = has ? normalized.filter((x) => x !== me) : [...normalized, me];
  const nextReactions = { ...reactions, [e]: nextEmails };

  // keep clean
  if (nextEmails.length === 0) {
    delete nextReactions[e];
  }

  return entities.Message.update(id, { reactions: nextReactions });
}

async function apiFetch(path, { method = 'GET', accessToken = null, body } = {}) {
  const url = `${BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? '' : '/'}${path}`;
  const hasBody = body !== undefined;
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(accessToken),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });

  const parsed = await safeReadJson(res);
  if (!res.ok) {
    const messageFromBody =
      (parsed && typeof parsed === 'object' && (parsed.error || parsed.message)) || null;
    const message = messageFromBody ? String(messageFromBody) : `Request failed: ${res.status}`;
    throw new Error(message);
  }

  return parsed;
}

export async function fetchConversations(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/conversations`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to fetch conversations: ${res.status}`;
      throw new Error(message);
    }

    return Array.isArray(body) ? body : body?.conversations || [];
  } catch (e) {
    if (myEmail) return localFetchConversations(myEmail);
    throw e;
  }
}

export async function fetchConversationsPage(options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const type = options?.type ? String(options.type) : null;
  const limit = Number.isFinite(options?.limit) ? Number(options.limit) : 20;
  const offset = Number.isFinite(options?.offset) ? Number(options.offset) : 0;
  const fields = options?.fields ? String(options.fields) : null;

  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/conversations`);
  if (type) url.searchParams.set('type', type);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (fields) url.searchParams.set('fields', fields);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to fetch conversations: ${res.status}`;
      throw new Error(message);
    }

    return Array.isArray(body) ? body : body?.conversations || [];
  } catch (e) {
    if (myEmail) {
      return localFetchConversationsPage(myEmail, { limit, offset, fields, type });
    }
    throw e;
  }
}

export async function createConversation(recipientEmail, options) {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/conversations`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(accessToken),
      },
      body: JSON.stringify({ recipient_email: recipientEmail }),
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to create conversation: ${res.status}`;
      throw new Error(message);
    }

    return body;
  } catch (e) {
    if (myEmail) return localFindOrCreateConversation(myEmail, recipientEmail);
    throw e;
  }
}

export async function fetchMessages(conversationId, options) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/conversations/${encodeURIComponent(id)}/messages`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to fetch messages: ${res.status}`;
      throw new Error(message);
    }

    return Array.isArray(body) ? body : body?.messages || [];
  } catch (e) {
    if (myEmail) return localFetchMessages(id);
    throw e;
  }
}

export async function fetchMessagesPage(conversationId, options) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const limit = Number.isFinite(options?.limit) ? Number(options.limit) : 20;
  const offset = Number.isFinite(options?.offset) ? Number(options.offset) : 0;
  const fields = options?.fields ? String(options.fields) : null;

  const url = new URL(`${BASE_URL.replace(/\/$/, '')}/conversations/${encodeURIComponent(id)}/messages`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  if (fields) url.searchParams.set('fields', fields);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to fetch messages: ${res.status}`;
      throw new Error(message);
    }

    return Array.isArray(body) ? body : body?.messages || [];
  } catch (e) {
    if (myEmail) return localFetchMessagesPage(id, { limit, offset, fields });
    throw e;
  }
}

export async function sendMessage(conversationId, bodyText, options) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/conversations/${encodeURIComponent(id)}/messages`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(accessToken),
      },
      body: JSON.stringify({ body: bodyText }),
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to send message: ${res.status}`;
      throw new Error(message);
    }

    return body;
  } catch (e) {
    if (myEmail) return localSendMessage(myEmail, id, bodyText);
    throw e;
  }
}

export async function markConversationRead(conversationId, options) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const url = `${BASE_URL.replace(/\/$/, '')}/conversations/${encodeURIComponent(id)}/read`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...authHeaders(accessToken),
      },
    });

    const body = await safeReadJson(res);

    if (!res.ok) {
      const messageFromBody =
        (body && typeof body === 'object' && (body.error || body.message)) || null;
      const message = messageFromBody
        ? String(messageFromBody)
        : `Failed to mark read: ${res.status}`;
      throw new Error(message);
    }

    return body ?? { ok: true };
  } catch (e) {
    if (myEmail) return localMarkConversationRead(myEmail, id);
    throw e;
  }
}

export async function actOnConversationRequest(conversationId, action, options) {
  const id = normalizeId(conversationId);
  if (!id) throw new Error('Conversation ID is required');
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;

  try {
    return apiFetch(`/conversations/${encodeURIComponent(id)}/request`, {
      method: 'POST',
      accessToken,
      body: { action },
    });
  } catch (e) {
    if (myEmail) return localActOnConversationRequest(myEmail, id, action);
    throw e;
  }
}

export async function toggleMessageReaction(messageId, emoji, options) {
  const id = normalizeId(messageId);
  if (!id) throw new Error('Message ID is required');
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  const myEmail = options?.myEmail ? String(options.myEmail) : null;
  const cleanEmoji = String(emoji || '').trim();
  if (!cleanEmoji) throw new Error('Emoji is required');

  try {
    if (!accessToken) throw new Error('Authentication required');
    return apiFetch(`/messages/${encodeURIComponent(id)}/reactions`, {
      method: 'POST',
      accessToken,
      body: { emoji: cleanEmoji },
    });
  } catch (e) {
    if (myEmail) return localToggleReaction(myEmail, id, cleanEmoji);
    throw e;
  }
}
