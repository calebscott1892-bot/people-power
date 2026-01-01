import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthProvider';
import { getServerBaseUrl } from '@/api/serverBase';
import { logError } from '@/utils/logError';
import AdminBackButton from '@/components/admin/AdminBackButton';

function fetchConfigs(accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/research-mode-configs`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to load research configs');
    return r.json();
  });
}
function addOrUpdateConfig(payload, accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/research-mode-configs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload)
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to update research config');
    return r.json();
  });
}
function deleteConfig(id, accessToken) {
  const baseUrl = getServerBaseUrl();
  return fetch(`${baseUrl}/admin/research-mode-configs/${id}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to delete research config');
    return r.json();
  });
}

export default function ResearchConfig() {
  const queryClient = useQueryClient();
  const { user, session, isAdmin } = useAuth();
  const accessToken = session?.access_token || null;
  const { data, isLoading, error } = useQuery({
    queryKey: ['researchConfigs'],
    queryFn: () => fetchConfigs(accessToken),
    enabled: !!accessToken && isAdmin,
  });
  const mutation = useMutation({
    mutationFn: (payload) => addOrUpdateConfig(payload, accessToken),
    onSuccess: () => queryClient.invalidateQueries(['researchConfigs']),
    onError: (err) => logError(err, 'Research config update failed'),
  });
  const delMutation = useMutation({
    mutationFn: (id) => deleteConfig(id, accessToken),
    onSuccess: () => queryClient.invalidateQueries(['researchConfigs']),
    onError: (err) => logError(err, 'Research config delete failed'),
  });

  const [scope, setScope] = useState('user');
  const [scopeId, setScopeId] = useState('');
  const [features, setFeatures] = useState('');

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
      <h1 className="text-3xl font-black text-slate-900 mb-2">Research Mode Config</h1>
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
        Admin mode – changes here affect the whole platform
      </div>
      <div className="mb-4 p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-slate-800 text-sm font-semibold">
        Admins can enable experimental features for specific users or movements. Research features are opt-in and do not affect production data.
      </div>
      {!accessToken ? (
        <div className="text-rose-700 font-semibold">Missing admin session.</div>
      ) : null}
      <form
        className="flex flex-col gap-3 p-4 border border-slate-200 rounded-xl bg-white"
        onSubmit={e => {
          e.preventDefault();
          mutation.mutate({
            scope,
            scope_id: scope === 'global' ? null : scopeId,
            enabled_features: features.split(',').map(f => f.trim()).filter(Boolean)
          });
        }}
      >
        <div className="flex gap-2 items-center">
          <label className="font-bold">Scope:</label>
          <select value={scope} onChange={e => setScope(e.target.value)} className="border rounded px-2 py-1">
            <option value="user">User (by email or id)</option>
            <option value="movement">Movement (by id)</option>
            <option value="global">Global</option>
          </select>
        </div>
        {scope !== 'global' && (
          <Input
            placeholder={scope === 'user' ? 'User email or id' : 'Movement id'}
            value={scopeId}
            onChange={e => setScopeId(e.target.value)}
            required
          />
        )}
        <Input
          placeholder="Enabled features (comma separated, e.g. exp_ai_impact_v2, exp_collab_graph)"
          value={features}
          onChange={e => setFeatures(e.target.value)}
          required
        />
        <Button type="submit" disabled={mutation.isLoading || !accessToken}>Add / Update</Button>
      </form>
      <div className="mt-8">
        <h2 className="text-lg font-black mb-2">Existing Research Flags</h2>
        {isLoading ? (
          <div>Loading…</div>
        ) : error ? (
          <div className="text-rose-700 font-semibold">Failed to load configs.</div>
        ) : (
          <table className="w-full text-sm border">
            <thead>
              <tr className="bg-slate-100">
                <th className="p-2">Scope</th>
                <th className="p-2">Scope Id</th>
                <th className="p-2">Features</th>
                <th className="p-2">Updated</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.configs?.map(cfg => (
                <tr key={cfg.id} className="border-t">
                  <td className="p-2 font-bold">{cfg.scope}</td>
                  <td className="p-2">{cfg.scope_id || <span className="text-slate-400">—</span>}</td>
                  <td className="p-2">{(cfg.enabled_features || []).join(', ')}</td>
                  <td className="p-2">{cfg.updated_at ? new Date(cfg.updated_at).toLocaleString() : ''}</td>
                  <td className="p-2">
                    <Button size="sm" variant="destructive" onClick={() => delMutation.mutate(cfg.id)} disabled={delMutation.isLoading}>Delete</Button>
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
