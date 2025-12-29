import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function fetchFlags() {
  return fetch('/admin/feature-flags').then(r => r.json());
}
function addOrUpdateFlag(payload) {
  return fetch('/admin/feature-flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(r => r.json());
}
function deleteFlag(id) {
  return fetch(`/admin/feature-flags/${id}`, { method: 'DELETE' }).then(r => r.json());
}

export default function FeatureFlags() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['featureFlags'],
    queryFn: fetchFlags
  });
  const mutation = useMutation({
    mutationFn: addOrUpdateFlag,
    onSuccess: () => queryClient.invalidateQueries(['featureFlags'])
  });
  const delMutation = useMutation({
    mutationFn: deleteFlag,
    onSuccess: () => queryClient.invalidateQueries(['featureFlags'])
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rollout, setRollout] = useState(100);
  const [enabled, setEnabled] = useState(true);

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <h1 className="text-3xl font-black text-slate-900 mb-2">Feature Flags</h1>
      <div className="mb-4 p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-slate-800 text-sm font-semibold">
        Admins can enable, disable, or roll out features to a percentage of users. Use for production features only (not research mode).
      </div>
      <form
        className="flex flex-col gap-3 p-4 border border-slate-200 rounded-xl bg-white"
        onSubmit={e => {
          e.preventDefault();
          mutation.mutate({
            name: name.trim(),
            enabled,
            rollout_percentage: Number(rollout),
            description: description.trim()
          });
        }}
      >
        <Input
          placeholder="Feature flag name (e.g. daily_challenges)"
          value={name}
          onChange={e => setName(e.target.value)}
          required
        />
        <Input
          placeholder="Description / notes"
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <div className="flex gap-2 items-center">
          <label className="font-bold">Enabled:</label>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <label className="font-bold ml-4">Rollout %:</label>
          <input
            type="number"
            min={0}
            max={100}
            value={rollout}
            onChange={e => setRollout(e.target.value)}
            className="border rounded px-2 py-1 w-20"
            required
          />
        </div>
        <Button type="submit" disabled={mutation.isLoading}>Add / Update</Button>
      </form>
      <div className="mt-8">
        <h2 className="text-lg font-black mb-2">Existing Feature Flags</h2>
        {isLoading ? (
          <div>Loading…</div>
        ) : error ? (
          <div className="text-rose-700 font-semibold">Failed to load flags.</div>
        ) : (
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-slate-100">
                <th className="p-2">Name</th>
                <th className="p-2">Description</th>
                <th className="p-2">Enabled</th>
                <th className="p-2">Rollout %</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.flags?.map(flag => (
                <tr key={flag.id} className="border-t">
                  <td className="p-2 font-bold">{flag.name}</td>
                  <td className="p-2">{flag.description || <span className="text-slate-400">—</span>}</td>
                  <td className="p-2">{flag.enabled ? 'Yes' : 'No'}</td>
                  <td className="p-2">{flag.rollout_percentage}</td>
                  <td className="p-2">{flag.updated_at ? new Date(flag.updated_at).toLocaleString() : ''}</td>
                  <td className="p-2">
                    <Button size="sm" variant="destructive" onClick={() => delMutation.mutate(flag.id)} disabled={delMutation.isLoading}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
