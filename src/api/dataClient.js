// Crash-proof local stubs.
// Guarantees:
// - exports: auth, entities, integrations
// - all methods exist, never throw, never hit network
// - return safe defaults (null/{} /[])
//
// Additionally, entities are persisted locally (localStorage when available,
// with an in-memory fallback) so onboarding/tutorial flows can complete.

// Use structured logging for warnings if needed in the future
const warn = (...args) => {};

export const auth = {
  isAuthenticated: async () => {
    // warn('auth.isAuthenticated called');
    return false;
  },
  me: async () => {
    // warn('auth.me called');
    return null;
  },
  redirectToLogin: (url) => {
    warn('auth.redirectToLogin called', url);
  },
  logout: (redirectUrl) => {
    warn('auth.logout called', redirectUrl);
  },
};

const memoryStore = new Map();

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function storageGet(key) {
  try {
    if (typeof window !== 'undefined' && window?.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    // ignore
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key, value) {
  try {
    if (typeof window !== 'undefined' && window?.localStorage) {
      window.localStorage.setItem(key, value);
      return;
    }
  } catch {
    // ignore
  }
  memoryStore.set(key, value);
}

function storageRemove(key) {
  try {
    if (typeof window !== 'undefined' && window?.localStorage) {
      window.localStorage.removeItem(key);
      return;
    }
  } catch {
    // ignore
  }
  memoryStore.delete(key);
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    // ignore
  }
  return `stub_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getEntityStorageKey(entityName) {
  return `peoplepower_stub_entities:${entityName}`;
}

function loadEntityRecords(entityName) {
  const key = getEntityStorageKey(entityName);
  return safeJsonParse(storageGet(key), []);
}

function saveEntityRecords(entityName, records) {
  const key = getEntityStorageKey(entityName);
  storageSet(key, JSON.stringify(records));
}

function matchesWhere(record, where) {
  if (!where) return true;
  const entries = Object.entries(where);
  for (const [k, v] of entries) {
    if (record?.[k] !== v) return false;
  }
  return true;
}

function normalizeSort(sort) {
  if (!sort) return null;
  const s = String(sort).trim();
  return s || null;
}

function normalizeFields(fields) {
  if (!fields) return null;
  if (Array.isArray(fields)) {
    const list = fields.map((f) => String(f || '').trim()).filter(Boolean);
    return list.length ? Array.from(new Set(list)) : null;
  }
  const list = String(fields)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? Array.from(new Set(list)) : null;
}

function projectFields(record, fields) {
  if (!fields) return record;
  const out = {};
  const want = new Set(['id', ...fields]);
  for (const key of want) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  return out;
}

function sortRecords(records, sort) {
  const s = normalizeSort(sort);
  if (!s) return records;

  const desc = s.startsWith('-');
  const field = desc ? s.slice(1) : s;
  if (!field) return records;

  const copy = [...records];
  copy.sort((a, b) => {
    const av = a?.[field];
    const bv = b?.[field];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    // dates and numbers sort naturally; otherwise string compare
    const an = typeof av === 'number' ? av : Number(av);
    const bn = typeof bv === 'number' ? bv : Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;

    const at = (() => {
      try {
        const t = new Date(av).getTime();
        return Number.isFinite(t) ? t : null;
      } catch {
        return null;
      }
    })();
    const bt = (() => {
      try {
        const t = new Date(bv).getTime();
        return Number.isFinite(t) ? t : null;
      } catch {
        return null;
      }
    })();
    if (at != null && bt != null) return at - bt;

    return String(av).localeCompare(String(bv));
  });

  return desc ? copy.reverse() : copy;
}

function createPersistentEntityApi(entityName) {
  return {
    list: async (sort, optionsOrLimit) => {
      warn(`entities.${entityName}.list called`);
      const records = loadEntityRecords(entityName);

      const normalizedOptions = typeof optionsOrLimit === 'number' ? { limit: optionsOrLimit } : optionsOrLimit;
      const sorted = sortRecords(records, sort);

      const limitRaw = normalizedOptions?.limit;
      const offsetRaw = normalizedOptions?.offset;
      const limit = Number.isFinite(Number(limitRaw)) ? Math.max(0, Number(limitRaw)) : null;
      const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;

      const sliced = limit != null ? sorted.slice(offset, offset + limit) : sorted.slice(offset);
      const fields = normalizeFields(normalizedOptions?.fields);
      return fields ? sliced.map((r) => projectFields(r, fields)) : sliced;
    },
    filter: async (where, sort, options) => {
      warn(`entities.${entityName}.filter called`, where);
      const records = loadEntityRecords(entityName);
      const safeWhere = where && typeof where === 'object' ? where : {};

      const filtered = records.filter((r) => matchesWhere(r, safeWhere));
      const sorted = sortRecords(filtered, sort);

      const normalizedOptions = typeof options === 'number' ? { limit: options } : options;

      const limitRaw = normalizedOptions?.limit;
      const offsetRaw = normalizedOptions?.offset;
      const limit = Number.isFinite(Number(limitRaw)) ? Math.max(0, Number(limitRaw)) : null;
      const offset = Number.isFinite(Number(offsetRaw)) ? Math.max(0, Number(offsetRaw)) : 0;

      const sliced = limit != null ? sorted.slice(offset, offset + limit) : sorted.slice(offset);

      const fields = normalizeFields(normalizedOptions?.fields);
      return fields ? sliced.map((r) => projectFields(r, fields)) : sliced;
    },
    create: async (data) => {
      warn(`entities.${entityName}.create called`, data);
      const records = loadEntityRecords(entityName);
      const record = { id: newId(), ...(data ?? {}) };
      records.push(record);
      saveEntityRecords(entityName, records);
      return record;
    },
    update: async (id, updates) => {
      warn(`entities.${entityName}.update called`, id, updates);
      const records = loadEntityRecords(entityName);
      const idx = records.findIndex((r) => r?.id === id);
      if (idx === -1) {
        const created = { id: id ?? newId(), ...(updates ?? {}) };
        records.push(created);
        saveEntityRecords(entityName, records);
        return created;
      }
      records[idx] = { ...records[idx], ...(updates ?? {}) };
      saveEntityRecords(entityName, records);
      return records[idx];
    },
    delete: async (id) => {
      warn(`entities.${entityName}.delete called`, id);
      const records = loadEntityRecords(entityName);
      const next = records.filter((r) => r?.id !== id);
      saveEntityRecords(entityName, next);
      return { ok: true };
    },
    _clearAll: async () => {
      const key = getEntityStorageKey(entityName);
      storageRemove(key);
      return { ok: true };
    },
  };
}

const safeEntityApi = {
  list: async (...args) => {
    warn('entities.*.list called', ...args);
    return [];
  },
  filter: async (...args) => {
    warn('entities.*.filter called', ...args);
    return [];
  },
  create: async (...args) => {
    warn('entities.*.create called', ...args);
    return {};
  },
  update: async (...args) => {
    warn('entities.*.update called', ...args);
    return {};
  },
  delete: async (...args) => {
    warn('entities.*.delete called', ...args);
    return {};
  },
};

export const entities = new Proxy(
  {},
  {
    get(_target, prop) {
      // avoid thenable weirdness / tooling introspection issues
      if (prop === 'then') return undefined;
      if (typeof prop !== 'string') return safeEntityApi;
      return createPersistentEntityApi(prop);
    },
  }
);

export const integrations = {
  Core: {
    InvokeLLM: async (...args) => {
      warn('integrations.Core.InvokeLLM called', ...args);
      // satisfy both shapes that might exist in the codebase
      return {
        text: '',
        choices: [{ message: { content: 'Stubbed response from local dev.' } }],
      };
    },
    UploadFile: async (...args) => {
      warn('integrations.Core.UploadFile called', ...args);
      return { file_url: null };
    },
  },
};

// Note: we intentionally do not export legacy aliases.