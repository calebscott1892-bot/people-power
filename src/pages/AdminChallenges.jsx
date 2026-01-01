import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchAdminChallenges, saveAdminChallenge, archiveAdminChallenge } from '@/api/challengesClient';
import { logError } from '@/utils/logError';
import AdminBackButton from '@/components/admin/AdminBackButton';

const CATEGORY_OPTIONS = [
  { value: 'kindness', label: 'Kindness' },
  { value: 'civic_literacy', label: 'Civic Literacy' },
  { value: 'community_care', label: 'Community Care' },
  { value: 'community', label: 'Community' },
  { value: 'environment', label: 'Environment' },
  { value: 'wellbeing', label: 'Wellbeing' },
];

export default function AdminChallenges() {
  const { session, isAdmin } = useAuth();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const queryClient = useQueryClient();

  const { data: challenges = [], isLoading, error } = useQuery({
    queryKey: ['adminChallenges'],
    enabled: !!accessToken && isAdmin,
    queryFn: () => fetchAdminChallenges(accessToken),
    retry: 1,
  });

  const mutation = useMutation({
    mutationFn: (payload) => saveAdminChallenge(payload, accessToken),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminChallenges'] });
    },
    onError: (err) => logError(err, 'Admin challenge save failed'),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => archiveAdminChallenge(id, accessToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminChallenges'] }),
    onError: (err) => logError(err, 'Admin challenge archive failed'),
  });

  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0].value);
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('active');

  const sortedChallenges = useMemo(() => {
    const list = Array.isArray(challenges) ? challenges : [];
    return [...list].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }, [challenges]);

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
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-8">
      <AdminBackButton />
      <div>
        <h1 className="text-3xl font-black text-slate-900 mb-2">Daily Challenges (Admin)</h1>
        <div className="inline-flex items-center px-3 py-1 rounded-full bg-slate-900 text-white text-xs font-black uppercase">
          Admin mode – changes here affect the whole platform
        </div>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-4">
        <div className="font-black text-slate-900">Create or update a challenge</div>
        <form
          className="grid gap-3 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              id: editingId || undefined,
              title: title.trim(),
              category,
              description: description.trim(),
              start_date: startDate || null,
              end_date: endDate || null,
              status,
            });
          }}
        >
          <Input
            placeholder="Challenge title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className="grid gap-2">
            <label className="text-xs font-black text-slate-600">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[96px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
            maxLength={1200}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label className="text-xs font-black text-slate-600">Start date (optional)</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-black text-slate-600">End date (optional)</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-xs font-black text-slate-600">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="rounded-xl font-bold">
              {editingId ? 'Update challenge' : 'Create challenge'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl font-bold"
              onClick={() => {
                setEditingId(null);
                setTitle('');
                setCategory(CATEGORY_OPTIONS[0].value);
                setDescription('');
                setStartDate('');
                setEndDate('');
                setStatus('active');
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="font-black text-slate-900 mb-3">Existing challenges</div>
        {!accessToken ? (
          <div className="text-slate-600 font-semibold">Missing admin session.</div>
        ) : isLoading ? (
          <div className="text-slate-600 font-semibold">Loading challenges…</div>
        ) : error ? (
          <div className="text-rose-700 font-semibold">Unable to load challenges.</div>
        ) : sortedChallenges.length === 0 ? (
          <div className="text-slate-600 font-semibold">No challenges configured yet.</div>
        ) : (
          <div className="grid gap-3">
            {sortedChallenges.map((challenge) => (
              <div
                key={challenge.id}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-black text-slate-900">{challenge.title}</div>
                  <div className="text-xs font-semibold text-slate-600 mt-1">
                    {challenge.category} · {challenge.status || 'active'}
                  </div>
                  {challenge.description ? (
                    <div className="text-sm text-slate-600 mt-2 line-clamp-3">{challenge.description}</div>
                  ) : null}
                  {(challenge.start_date || challenge.end_date) ? (
                    <div className="text-xs text-slate-500 font-semibold mt-2">
                      {challenge.start_date || 'Any time'} → {challenge.end_date || 'Open ended'}
                    </div>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl font-bold"
                    onClick={() => {
                      setEditingId(String(challenge.id));
                      setTitle(String(challenge.title || ''));
                      setCategory(String(challenge.category || CATEGORY_OPTIONS[0].value));
                      setDescription(String(challenge.description || ''));
                      setStartDate(String(challenge.start_date || ''));
                      setEndDate(String(challenge.end_date || ''));
                      setStatus(String(challenge.status || 'active'));
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl font-bold"
                    onClick={() => archiveMutation.mutate(challenge.id)}
                    disabled={archiveMutation.isPending}
                  >
                    Archive
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
