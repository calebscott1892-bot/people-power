export function httpFetch(input, init) {
  const f = globalThis.fetch;
  if (typeof f !== 'function') {
    throw new Error('Fetch is not available in this environment');
  }
  return f(input, init);
}
