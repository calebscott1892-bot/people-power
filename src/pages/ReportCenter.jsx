import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { toastFriendlyError } from '@/utils/toastErrors';
import { useAuth } from '@/auth/AuthProvider';
import { createReport } from '@/api/reportsClient';
import { uploadFile } from '@/api/uploadsClient';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';
import {
  REPORT_TUTORIAL_KEY,
  REPORT_REASONS,
  BUG_REASONS,
  BUG_TITLE_MAX,
  BUG_DETAILS_MAX,
} from '@/components/safety/reportingConfig';
import {
  normalizeReporterEmail,
  checkReportingEligibility,
  loadRecentReportTimes,
  saveRecentReportTimes,
} from '@/components/safety/reportingUtils';
import { logError } from '@/utils/logError';

export default function ReportCenter() {
  const { session } = useAuth();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const reporterEmail = useMemo(
    () => normalizeReporterEmail(session?.user?.email),
    [session]
  );
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const [tutorialSeen, setTutorialSeen] = useState(true);
  const [activeType, setActiveType] = useState('');
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [bugCategory, setBugCategory] = useState('');
  const [bugTitle, setBugTitle] = useState('');
  const [bugDetails, setBugDetails] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceLink, setEvidenceLink] = useState('');
  const [bugPage, setBugPage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const contextType = String(searchParams.get('type') || '').trim();
  const contextId = String(searchParams.get('id') || '').trim();
  const contextLabelRaw = String(searchParams.get('label') || '').trim();
  const safeContextLabel = contextLabelRaw && !contextLabelRaw.includes('@') ? contextLabelRaw : '';

  useEffect(() => {
    try {
      const seen = localStorage.getItem(REPORT_TUTORIAL_KEY) === 'true';
      setTutorialSeen(seen);
    } catch {
      setTutorialSeen(true);
    }
  }, []);

  useEffect(() => {
    if (!activeType) return;
    setSubmitted(false);
  }, [activeType]);

  useEffect(() => {
    if (!bugPage) {
      const fallback = searchParams.get('page') || searchParams.get('url') || '';
      if (fallback) setBugPage(String(fallback));
    }
  }, [bugPage, searchParams]);

  const prefilledBugPage = useMemo(() => {
    const fallback =
      bugPage ||
      (location?.state && typeof location.state === 'string' ? location.state : '') ||
      '';
    return String(fallback || '').trim();
  }, [bugPage, location]);

  const selectedReason = useMemo(() => {
    if (activeType === 'bug') {
      return BUG_REASONS.find((r) => r.value === bugCategory) || null;
    }
    return REPORT_REASONS.find((r) => r.value === category) || null;
  }, [activeType, bugCategory, category]);

  const renderContextLine = () => {
    if (!contextType) return 'General report (no item selected).';
    const label = safeContextLabel ? ` — ${safeContextLabel}` : '';
    return `Reporting ${contextType}${label}.`;
  };

  const clearForm = () => {
    setCategory('');
    setDetails('');
    setBugCategory('');
    setBugTitle('');
    setBugDetails('');
    setEvidenceFile(null);
    setEvidenceLink('');
  };

  const handleSubmit = async () => {
    if (!activeType) return;
    if (!reporterEmail) {
      toast.error('Please sign in to submit a report.');
      return;
    }

    const isBug = activeType === 'bug';
    const reasonValue = isBug ? bugCategory : category;
    if (!reasonValue) {
      toast.error('Please select a category.');
      return;
    }

    const cleanDetails = String(isBug ? bugDetails : details).trim();
    if (isBug) {
      if (!String(bugTitle || '').trim()) {
        toast.error('Please add a short title for the bug report.');
        return;
      }
      if (!cleanDetails) {
        toast.error('Please describe the issue.');
        return;
      }
      if (cleanDetails.length > BUG_DETAILS_MAX) {
        toast.error(`Please keep the description under ${BUG_DETAILS_MAX} characters.`);
        return;
      }
    } else if (reasonValue === 'other' && !cleanDetails) {
      toast.error('Please add a short explanation for “Other”.');
      return;
    }

    setSubmitting(true);
    try {
      const eligibility = await checkReportingEligibility(reporterEmail);
      if (!eligibility.ok) {
          const reason = String(eligibility.reason || '').trim();
          toastFriendlyError(reason ? new Error(reason) : null, reason || 'Cannot submit report right now');
        setSubmitting(false);
        return;
      }

      let evidenceFileUrl = null;
      if (evidenceFile) {
        try {
          if (!accessToken) throw new Error('Please sign in to upload evidence');
          const res = await uploadFile(evidenceFile, {
            accessToken,
            maxBytes: MAX_UPLOAD_BYTES,
            allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
          });
          evidenceFileUrl = res?.url ? String(res.url) : null;
        } catch (e) {
          logError(e, 'ReportCenter evidence upload failed', { type: activeType });
          toast.error('Failed to upload evidence');
          setSubmitting(false);
          return;
        }
      }

      const now = Date.now();
      const fingerprint = `${String(contextType || 'general')}:${String(contextId || 'manual')}`;
      let isRepeatReport = false;
      try {
        const key = reporterEmail ? `peoplepower_report_fingerprints:${reporterEmail}` : null;
        const raw = key ? localStorage.getItem(key) : null;
        const list = raw ? JSON.parse(raw) : [];
        const arr = Array.isArray(list) ? list.map(String) : [];
        isRepeatReport = arr.includes(fingerprint);
      } catch {
        // ignore
      }

      const bugContextId = prefilledBugPage || '/';
      const detailsWithLink = evidenceLink
        ? `${cleanDetails}\n\nLink: ${String(evidenceLink).trim()}`
        : cleanDetails;

      await createReport(
        {
          report_type: activeType,
          report_title: isBug ? String(bugTitle || '').trim() : null,
          reported_content_type: isBug ? 'app' : String(contextType || 'general'),
          reported_content_id: isBug ? bugContextId : String(contextId || 'manual'),
          report_category: reasonValue,
          report_details: detailsWithLink || null,
          evidence_file_url: evidenceFileUrl || undefined,
          evidence_urls: evidenceFileUrl ? [evidenceFileUrl] : undefined,
          is_repeat_report: isRepeatReport || undefined,
        },
        { accessToken, reporterEmail }
      );

      const times = loadRecentReportTimes(reporterEmail);
      saveRecentReportTimes(reporterEmail, [...times, now]);
      try {
        const key = `peoplepower_report_fingerprints:${reporterEmail}`;
        const raw = localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        const arr = Array.isArray(list) ? list.map(String) : [];
        if (!arr.includes(fingerprint)) {
          localStorage.setItem(key, JSON.stringify([...arr, fingerprint].slice(-200)));
        }
      } catch {
        // ignore
      }

      toast.success('Thanks for reporting. We’ll review this.');
      setSubmitted(true);
      clearForm();
    } catch (e) {
      logError(e, 'ReportCenter submission failed', { type: activeType });
      toast.error("Couldn't submit report right now");
    } finally {
      setSubmitting(false);
    }
  };

  const activeReasons = activeType === 'bug' ? BUG_REASONS : REPORT_REASONS;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-3xl shadow-2xl border-3 border-slate-200 overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900">Report Center</h1>
          {!tutorialSeen ? (
            <div className="mt-4 p-4 rounded-2xl border border-slate-200 bg-slate-50">
              <div className="font-black text-slate-900">How reporting works</div>
              <ul className="mt-2 text-sm text-slate-700 space-y-1 font-semibold">
                <li>Use this to report harmful or abusive behavior.</li>
                <li>Use this to report technical problems with the app.</li>
                <li>We may not respond instantly, but serious reports are reviewed.</li>
              </ul>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem(REPORT_TUTORIAL_KEY, 'true');
                  } catch {
                    // ignore
                  }
                  setTutorialSeen(true);
                }}
                className="mt-3 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-black"
              >
                Got it
              </button>
            </div>
          ) : (
            <ul className="mt-3 text-sm text-slate-600 font-semibold space-y-1">
              <li>Use this to report harmful or abusive behavior.</li>
              <li>Use this to report technical problems with the app.</li>
              <li>We may not respond instantly, but serious reports are reviewed.</li>
            </ul>
          )}
        </div>

        <div className="p-5 sm:p-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setActiveType('abuse')}
              className={`p-4 rounded-2xl border-2 text-left font-black ${
                activeType === 'abuse'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              Report harmful behavior or content
            </button>
            <button
              type="button"
              onClick={() => setActiveType('bug')}
              className={`p-4 rounded-2xl border-2 text-left font-black ${
                activeType === 'bug'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              Report a technical issue / bug
            </button>
          </div>

          {!reporterEmail ? (
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-700 font-semibold">
              Please sign in to submit a report.
            </div>
          ) : null}

          {submitted ? (
            <div className="p-4 rounded-2xl border border-slate-200 bg-emerald-50 text-sm text-emerald-800 font-semibold">
              Thanks for reporting. We’ll review this.
            </div>
          ) : null}

          {activeType ? (
            <div className="space-y-4">
              <div className="text-xs text-slate-600 font-semibold">
                {activeType === 'bug' ? 'Bug report' : 'Behavior report'} • {renderContextLine()}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">
                  {activeType === 'bug' ? 'Bug category' : 'Report category'}
                </label>
                <select
                  value={activeType === 'bug' ? bugCategory : category}
                  onChange={(e) => {
                    if (activeType === 'bug') setBugCategory(e.target.value);
                    else setCategory(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
                >
                  <option value="">Select a category…</option>
                  {activeReasons.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                {selectedReason ? (
                  <div className="text-xs text-slate-500 font-semibold">{selectedReason.description}</div>
                ) : null}
              </div>

              {activeType === 'bug' ? (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-700">Short title</label>
                    <input
                      value={bugTitle}
                      onChange={(e) => setBugTitle(e.target.value.slice(0, BUG_TITLE_MAX))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
                      placeholder="Short summary of the issue"
                    />
                    <div className="text-xs text-slate-500 font-semibold">
                      {bugTitle.length}/{BUG_TITLE_MAX}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-700">Affected page (optional)</label>
                    <input
                      value={prefilledBugPage}
                      onChange={(e) => setBugPage(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
                      placeholder="e.g. /movements/123"
                    />
                  </div>
                </>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">
                  {activeType === 'bug' ? 'Description (required)' : 'Description (required for “Other”)'}
                </label>
                <textarea
                  value={activeType === 'bug' ? bugDetails : details}
                  onChange={(e) => {
                    if (activeType === 'bug') setBugDetails(e.target.value.slice(0, BUG_DETAILS_MAX));
                    else setDetails(e.target.value);
                  }}
                  className="w-full min-h-28 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
                  placeholder={activeType === 'bug' ? 'Describe what you expected vs what happened.' : 'What happened?'}
                />
                {activeType === 'bug' ? (
                  <div className="text-xs text-slate-500 font-semibold">
                    {bugDetails.length}/{BUG_DETAILS_MAX}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">Optional link</label>
                <input
                  value={evidenceLink}
                  onChange={(e) => setEvidenceLink(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold"
                  placeholder="https://example.com"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-slate-700">
                  {activeType === 'bug' ? 'Screenshot (optional)' : 'Evidence file (optional)'}
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,application/pdf"
                  onChange={(e) => {
                    const file = (e.target.files && e.target.files[0]) || null;
                    e.target.value = '';
                    if (!file) {
                      setEvidenceFile(null);
                      return;
                    }
                    const validationError = validateFileUpload({
                      file,
                      maxBytes: MAX_UPLOAD_BYTES,
                      allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
                    });
                    if (validationError) {
                      toast.error(validationError);
                      setEvidenceFile(null);
                      return;
                    }
                    setEvidenceFile(file);
                  }}
                  className="block w-full text-sm"
                />
                <div className="text-xs text-slate-500 font-semibold">
                  Upload a screenshot or PDF if helpful. Avoid sharing sensitive personal data.
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    clearForm();
                    setActiveType('');
                  }}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 font-black hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || !reporterEmail}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90 disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : 'Submit report'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
