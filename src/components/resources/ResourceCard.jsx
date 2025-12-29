import React from 'react';

export default function ResourceCard({ resource }) {
  const title = resource?.title || resource?.name || 'Untitled resource';
  const url = resource?.url || resource?.link || null;
  const description = resource?.description || '';

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-white">
      <div className="font-black text-slate-900">{String(title)}</div>
      {description ? (
        <div className="mt-1 text-sm text-slate-600 font-semibold">{String(description)}</div>
      ) : null}

      {url ? (
        <a
          href={String(url)}
          target="_blank"
          rel="noreferrer"
          className="inline-block mt-3 text-sm font-black text-[#3A3DFF]"
        >
          Open
        </a>
      ) : (
        <div className="mt-3 text-xs text-slate-500 font-semibold">No link provided.</div>
      )}
    </div>
  );
}