import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthProvider';
import { getServerBaseUrl } from '@/api/serverBase';
import { logError } from '@/utils/logError';
import AdminBackButton from '@/components/admin/AdminBackButton';

function fetchFlags(accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/feature-flags`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to load feature flags');
    return r.json();
  });
}
function addOrUpdateFlag(payload, accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/feature-flags`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload)
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to update feature flag');
    return r.json();
  });
}
function deleteFlag(id, accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/feature-flags/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to delete feature flag');
    return r.json();
  });
}

export default function FeatureFlags() {
  const queryClient = useQueryClient();
  const { user, session, isAdmin } = useAuth();
  const accessToken = session?.access_token || null;
  const { data, isLoading, error } = useQuery({
    queryKey: ['featureFlags'],
    queryFn: () => fetchFlags(accessToken),
    enabled: !!accessToken && isAdmin,
  });
  const mutation = useMutation({
    mutationFn: (payload) => addOrUpdateFlag(payload, accessToken),
    onSuccess: () => queryClient.invalidateQueries(['featureFlags']),
    onError: (err) => logError(err, 'Feature flag update failed'),
  });
  const delMutation = useMutation({
    mutationFn: (id) => deleteFlag(id, accessToken),
    onSuccess: () => queryClient.invalidateQueries(['featureFlags']),
    onError: (err) => logError(err, 'Feature flag delete failed'),
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rollout, setRollout] = useState(100);
  const [enabled, setEnabled] = useState(true);

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="text-xl font-black text-slate-900">Not authorized</div>
          <div className="mt-2 text-slate-600 font-semibold">
            This page is only available to admin accounts.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      <AdminBackButton />
      <h1 className="text-3xl font-black text-slate-900 mb-2">Feature Flags</h1>
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
        Admin mode – changes here affect the whole platform
      </div>
      <div className="mb-4 p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-slate-800 text-sm font-semibold">
        Admins can enable, disable, or roll out features to a percentage of users. Use for production features only (not research mode).
      </div>
      {!accessToken ? (
        <div className="text-rose-700 font-semibold">Missing admin session.</div>
      ) : null}
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
        <Button type="submit" disabled={mutation.isLoading || !accessToken}>Add / Update</Button>
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
