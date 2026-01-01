/**
 * App-owned client surface.
 *
 * Goal: keep an app-owned client surface (no third-party SDK coupling).
 * Today this is backed by the local persistent stub in `dataClient`.
 * Over time, this module should be re-pointed to your Workers + Postgres + R2 API.
 */

import {
	auth as localAuth,
	entities as localEntities,
	integrations as localIntegrations,
} from './dataClient';

// IMPORTANT: Many legacy REST clients in this repo already use VITE_API_BASE_URL
// (pointing at the Fastify server). To avoid accidentally switching the entire
// appClient surface to a server that doesn't implement `/api/entities/*`, we
// use a dedicated variable.
//
// Supported values:
// - "http://127.0.0.1:8787" (direct to Worker)
// - "relative" (use same-origin URLs like "/api/..."; handy with Vite proxy)
const RAW_API_BASE_URL = (import.meta?.env?.VITE_APP_API_BASE_URL || '').trim();
const ENABLE_REMOTE = RAW_API_BASE_URL.length > 0;
const API_BASE_URL = RAW_API_BASE_URL === 'relative' ? '' : RAW_API_BASE_URL;

function joinUrl(base, path) {
	const b = String(base || '').replace(/\/$/, '');
	const p = String(path || '').startsWith('/') ? path : `/${path}`;
	return `${b}${p}`;
}

async function httpJson(baseUrl, path, init) {
	const res = await fetch(joinUrl(baseUrl, path), {
		...init,
		headers: {
			'content-type': 'application/json',
			...(init?.headers || {}),
		},
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(text || `Request failed (${res.status})`);
	}

	if (res.status === 204) return null;
	return res.json().catch(() => null);
}

function createRemoteEntities(baseUrl) {
	const safeEntityApi = {
		list: async () => [],
		filter: async () => [],
		create: async () => ({}),
		update: async () => ({}),
		delete: async () => ({ ok: true }),
	};

	return new Proxy(
		{},
		{
			get(_target, prop) {
				if (prop === 'then') return undefined;
				if (typeof prop !== 'string') return safeEntityApi;

				const entityName = prop;

				return {
					list: async (sort, optionsOrLimit) => {
						const opts = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
						const params = new URLSearchParams();
						if (sort) params.set('sort', String(sort));
						if (opts?.limit != null) params.set('limit', String(opts.limit));
						if (opts?.offset != null) params.set('offset', String(opts.offset));
						if (opts?.fields) params.set('fields', Array.isArray(opts.fields) ? opts.fields.join(',') : String(opts.fields));
						const qs = params.toString();
						return httpJson(baseUrl, `/api/entities/${encodeURIComponent(entityName)}${qs ? `?${qs}` : ''}`, {
							method: 'GET',
						});
					},
					filter: async (where, sort, options) => {
						const opts = typeof options === 'number' ? { limit: options } : options;
						const params = new URLSearchParams();
						if (where && typeof where === 'object') params.set('where', JSON.stringify(where));
						if (sort) params.set('sort', String(sort));
						if (opts?.limit != null) params.set('limit', String(opts.limit));
						if (opts?.offset != null) params.set('offset', String(opts.offset));
						if (opts?.fields) params.set('fields', Array.isArray(opts.fields) ? opts.fields.join(',') : String(opts.fields));
						const qs = params.toString();
						return httpJson(baseUrl, `/api/entities/${encodeURIComponent(entityName)}${qs ? `?${qs}` : ''}`, {
							method: 'GET',
						});
					},
					create: async (data) => {
						return httpJson(baseUrl, `/api/entities/${encodeURIComponent(entityName)}`, {
							method: 'POST',
							body: JSON.stringify(data ?? {}),
						});
					},
					update: async (id, patch) => {
						return httpJson(baseUrl, `/api/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(String(id))}`, {
							method: 'PATCH',
							body: JSON.stringify(patch ?? {}),
						});
					},
					delete: async (id) => {
						return httpJson(baseUrl, `/api/entities/${encodeURIComponent(entityName)}/${encodeURIComponent(String(id))}`, {
							method: 'DELETE',
						});
					},
				};
			},
		}
	);
}

function createRemoteIntegrations(baseUrl) {
	return {
		Core: {
			InvokeLLM: async (payload) => {
				return httpJson(baseUrl, '/api/integrations/core/invoke-llm', {
					method: 'POST',
					body: JSON.stringify(payload ?? {}),
				});
			},
			UploadFile: async (payload) => {
				return httpJson(baseUrl, '/api/integrations/core/upload-file', {
					method: 'POST',
					body: JSON.stringify(payload ?? {}),
				});
			},
		},
	};
}

function createRemoteAuth(baseUrl) {
	return {
		isAuthenticated: async () => {
			const me = await httpJson(baseUrl, '/api/auth/me', { method: 'GET' });
			return !!me;
		},
		me: async () => {
			return httpJson(baseUrl, '/api/auth/me', { method: 'GET' });
		},
		redirectToLogin: (_url) => {
			// Placeholder: implement real auth redirects when auth is added.
			// Placeholder: implement real auth redirects when auth is added. Use structured logging if needed.
		},
		logout: (_redirectUrl) => {
			// Placeholder: implement real logout when auth is added. Use structured logging if needed.
		},
	};
}

const remote = ENABLE_REMOTE
	? {
			auth: createRemoteAuth(API_BASE_URL),
			entities: createRemoteEntities(API_BASE_URL),
			integrations: createRemoteIntegrations(API_BASE_URL),
		}
	: null;

export const auth = remote?.auth ?? localAuth;
export const entities = remote?.entities ?? localEntities;
export const integrations = remote?.integrations ?? localIntegrations;

export const app = { auth, entities, integrations };

export default app;
