import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { createReport } from '@/api/reportsClient';
import { uploadFile } from '@/api/uploadsClient';
import { logError } from '@/utils/logError';
import { Link } from 'react-router-dom';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';
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

export default function ReportButton({
  contentType = 'movement',
  contentId,
  className = '',
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, [open]);
  const [reportType, setReportType] = useState('abuse');
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [bugCategory, setBugCategory] = useState('');
  const [bugTitle, setBugTitle] = useState('');
  const [bugDetails, setBugDetails] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [tutorialSeen, setTutorialSeen] = useState(true);

  const safeContentId = useMemo(() => String(contentId ?? '').trim(), [contentId]);
  const disabled = !safeContentId;
  const reportCenterLink = useMemo(() => {
    if (!safeContentId) return '/report';
    const type = encodeURIComponent(String(contentType || 'content'));
    const id = encodeURIComponent(safeContentId);
    return `/report?type=${type}&id=${id}`;
  }, [contentType, safeContentId]);

  useEffect(() => {
    if (!open) return;
    try {
      const seen = localStorage.getItem(REPORT_TUTORIAL_KEY) === 'true';
      setTutorialSeen(seen);
    } catch {
      setTutorialSeen(true);
    }
  }, [open]);

  useEffect(() => {
    if (open) return;
    setReportType('abuse');
    setCategory('');
    setDetails('');
    setBugCategory('');
    setBugTitle('');
    setBugDetails('');
    setEvidenceFile(null);
  }, [open]);

  useEffect(() => {
    if (reportType === 'bug') {
      setCategory('');
      setDetails('');
    } else {
      setBugCategory('');
      setBugTitle('');
      setBugDetails('');
    }
  }, [reportType]);

  const activeReasons = reportType === 'bug' ? BUG_REASONS : REPORT_REASONS;
  const selectedReason = useMemo(
    () => activeReasons.find((r) => r.value === (reportType === 'bug' ? bugCategory : category)) || null,
    [activeReasons, reportType, bugCategory, category]
  );

  const reporterEmail = useMemo(
    () => normalizeReporterEmail(session?.user?.email),
    [session]
  );

  const handleSubmit = async () => {
    if (disabled) return;
    const isBugReport = reportType === 'bug';
    const reasonValue = isBugReport ? bugCategory : category;
    const detailsValue = isBugReport ? bugDetails : details;

    if (!reasonValue) {
      toast.error('Please select a category');
      return;
    }

    if (isBugReport) {
      if (!String(bugTitle || '').trim()) {
        toast.error('Please add a short title for the bug report');
        return;
      }
      if (!String(detailsValue || '').trim()) {
        toast.error('Please describe the issue');
        return;
      }
      if (String(detailsValue || '').length > BUG_DETAILS_MAX) {
        toast.error(`Please keep the description under ${BUG_DETAILS_MAX} characters`);
        return;
      }
    } else if (reasonValue === 'other' && !String(detailsValue || '').trim()) {
      toast.error('Please add a short explanation for “Other”');
      return;
    }

    setSubmitting(true);
    try {
      const eligibility = await checkReportingEligibility(reporterEmail);
      if (!eligibility.ok) {
        toast.error(String(eligibility.reason || 'Cannot submit report right now'));
        return;
      }

      const accessToken = session?.access_token ? String(session.access_token) : null;

      // Upload evidence file first (optional)
      let evidenceFileUrl = null;
      if (evidenceFile) {
        try {
          if (!accessToken) {
            toast.error('Log in to upload evidence');
            return;
          }
          const res = await uploadFile(evidenceFile, {
            accessToken,
            maxBytes: MAX_UPLOAD_BYTES,
            allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
          });
          evidenceFileUrl = res?.url ? String(res.url) : null;
        } catch (e) {
          logError(e, 'ReportButton evidence upload failed', { contentType: String(contentType), contentId: safeContentId });
          toast.error('Failed to upload evidence');
          return;
        }
      }

      const now = Date.now();
      const fingerprint = `${String(contentType)}:${safeContentId}`;
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

      const bugContextId = (() => {
        if (typeof window !== 'undefined' && window.location?.pathname) {
          return window.location.pathname;
        }
        return safeContentId || 'app';
      })();

      await createReport(
        {
          report_type: reportType,
          report_title: isBugReport ? String(bugTitle || '').trim() : null,
          reported_content_type: isBugReport ? 'app' : String(contentType),
          reported_content_id: isBugReport ? bugContextId : safeContentId,
          report_category: reasonValue,
          report_details: detailsValue || null,
          evidence_file_url: evidenceFileUrl || undefined,
          evidence_urls: evidenceFileUrl ? [evidenceFileUrl] : undefined,
          is_repeat_report: isRepeatReport || undefined,
        },
        { accessToken, reporterEmail }
      );

      if (reporterEmail) {
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
      }

      toast.success('Report submitted. Thank you.');
      setOpen(false);
      setCategory('');
      setDetails('');
      setBugCategory('');
      setBugTitle('');
      setBugDetails('');
      setEvidenceFile(null);
    } catch (e) {
      logError(e, 'Failed to submit report', { contentType: String(contentType), contentId: safeContentId });
      toast.error("Couldn't submit report right now");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-black hover:bg-slate-50 ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${className}`}
        title={disabled ? 'Reporting not available' : 'Report'}
      >
        Report
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="presentation"
          onKeyDown={(e) => {
            trapFocusKeyDown(e, dialogRef.current);
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="report_modal_title"
            aria-describedby="report_modal_desc"
            tabIndex={-1}
            className="relative w-full max-w-sm sm:max-w-md rounded-3xl bg-white border border-slate-200 shadow-lg overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-5 py-4 text-slate-900">
              <div id="report_modal_title" className="font-black text-lg">Report</div>
              <div id="report_modal_desc" className="text-xs font-semibold text-slate-800 mt-1">
                Your identity is kept private from the reported user.
              </div>
            </div>

            <div className="p-5 space-y-3">
              {!tutorialSeen ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <div className="font-black text-slate-900">How reporting works</div>
                  <ul className="text-xs text-slate-600 font-semibold space-y-2 list-disc pl-4">
                    <li>People Power is a neutral facilitation platform.</li>
                    <li>Content reports go to moderators; site bug reports go to the dev team.</li>
                    <li>Use reports for safety issues, not good-faith disagreements.</li>
                    <li>Submitting a report doesn’t guarantee removal, but flags for review.</li>
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
                    className="w-full px-4 py-2 rounded-xl bg-slate-900 text-white font-black hover:opacity-90"
                  >
                    Got it
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setReportType('abuse')}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border ${
                        reportType === 'abuse' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      Report content or behaviour
                    </button>
                    <button
                      type="button"
                      onClick={() => setReportType('bug')}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-black border ${
                        reportType === 'bug' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                      }`}
                    >
                      Report a problem with the app
                    </button>
                  </div>

                  {!reporterEmail ? (
                    <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      Please sign in to submit a report.
                    </div>
                  ) : null}

                  <label className="text-sm font-black text-slate-700">Category</label>
                  <select
                    value={reportType === 'bug' ? bugCategory : category}
                    onChange={(e) => {
                      if (reportType === 'bug') setBugCategory(e.target.value);
                      else setCategory(e.target.value);
                    }}
                    className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                  >
                    <option value="">Select…</option>
                    {activeReasons.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>

                  {selectedReason ? (
                    <div className="text-xs text-slate-600 font-semibold">
                      {selectedReason.description}
                    </div>
                  ) : null}

                  {reportType === 'bug' ? (
                    <>
                      <label className="text-sm font-black text-slate-700">Short title</label>
                      <input
                        value={bugTitle}
                        onChange={(e) => setBugTitle(e.target.value.slice(0, BUG_TITLE_MAX))}
                        className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                        placeholder="E.g. Create button not responding"
                        maxLength={BUG_TITLE_MAX}
                      />
                      <div className="text-xs text-slate-500 font-semibold">
                        Page: {typeof window !== 'undefined' ? window.location.pathname : 'current page'}
                      </div>
                    </>
                  ) : null}

                  <label className="text-sm font-black text-slate-700">
                    {reportType === 'bug' ? 'Description' : 'Explanation (optional)'}
                    {reportType === 'bug' || (reportType === 'abuse' && category === 'other') ? (
                      <span className="text-rose-700"> *</span>
                    ) : null}
                  </label>
                  <textarea
                    value={reportType === 'bug' ? bugDetails : details}
                    onChange={(e) => {
                      if (reportType === 'bug') setBugDetails(e.target.value.slice(0, BUG_DETAILS_MAX));
                      else setDetails(e.target.value);
                    }}
                    className="w-full min-h-24 p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
                    placeholder={reportType === 'bug' ? 'Describe what you expected vs what happened.' : 'What happened?'}
                  />
                  {reportType === 'bug' ? (
                    <div className="text-xs text-slate-500 font-semibold">
                      {bugDetails.length}/{BUG_DETAILS_MAX}
                    </div>
                  ) : null}

                  <div className="pt-1 space-y-2">
                    <label className="text-sm font-black text-slate-700">
                      {reportType === 'bug' ? 'Screenshot (optional)' : 'Evidence file (optional)'}
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
                      Upload a screenshot or PDF if helpful. Please avoid sharing highly sensitive personal data.
                    </div>
                  </div>

                  <div className="flex gap-2 justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
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
                      {submitting ? 'Submitting…' : 'Submit'}
                    </button>
                  </div>

                  <div className="text-xs text-slate-500 font-semibold">
                    Reports are reviewed by moderators. Abuse of reporting may lead to restrictions.
                  </div>

                  <div className="text-xs font-semibold">
                    <Link
                      to="/safety-faq"
                      className="text-[#3A3DFF] hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      Learn more about reporting
                    </Link>
                    <span className="mx-2 text-slate-300">•</span>
                    <Link
                      to={reportCenterLink}
                      className="text-[#3A3DFF] hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      Open Report Center
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
