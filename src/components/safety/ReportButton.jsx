import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { createReport } from '@/api/reportsClient';
import { uploadFile } from '@/api/uploadsClient';
import { entities } from '@/api/appClient';
import { logError } from '@/utils/logError';
import { Link } from 'react-router-dom';
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

const REPORT_REASONS = [
  {
    value: 'harassment_or_bullying',
    label: 'Harassment or Bullying',
    description: 'Targeted harassment, intimidation, or repeated unwanted contact directed at a person or group.',
  },
  {
    value: 'hate_speech_or_discrimination',
    label: 'Hate Speech or Discrimination',
    description: 'Hate, slurs, or discrimination based on protected characteristics (or similar).',
  },
  {
    value: 'incitement_of_violence_or_harm',
    label: 'Incitement of Violence or Harm',
    description: 'Threats, calls for violence, or encouragement of physical harm or destruction.',
  },
  {
    value: 'illegal_activity_or_dangerous_conduct',
    label: 'Illegal Activity or Dangerous Conduct',
    description: 'Coordination of illegal acts or dangerous conduct that could put people at risk.',
  },
  {
    value: 'misinformation_or_deceptive_activity',
    label: 'Misinformation / Deceptive Activity',
    description: 'Deceptive claims or manipulative content that could mislead people into harm or fraud.',
  },
  {
    value: 'spam_or_scams',
    label: 'Spam or Scams',
    description: 'Spam, repetitive promotion, scams, phishing, or suspicious links.',
  },
  {
    value: 'privacy_violation_or_doxxing',
    label: 'Privacy Violation / Doxxing',
    description: 'Sharing private personal info (addresses, phone numbers, IDs) without consent.',
  },
  {
    value: 'underage_safety_concern',
    label: 'Underage Safety Concern',
    description: 'Content that raises concerns about minors’ safety or exploitation.',
  },
  {
    value: 'impersonation_or_identity_fraud',
    label: 'Impersonation / Identity Fraud',
    description: 'Pretending to be someone else, or misrepresenting identity to deceive others.',
  },
  {
    value: 'inappropriate_content',
    label: 'Inappropriate Content',
    description: 'Adult or otherwise inappropriate content that violates community safety expectations.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Anything else that does not fit the categories above (please add a short explanation).',
  },
];

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REPORTS = 3;
const REPORT_MAX_UPLOAD_MB = 5;
const REPORT_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];

function normalizeEmail(value) {
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return s || null;
}

function getRateKey(email) {
  return `peoplepower_report_rate:${email}`;
}

function loadRecentReportTimes(email) {
  const key = getRateKey(email);
  try {
    const raw = localStorage.getItem(key);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t))
      .filter((t) => now - t < RATE_WINDOW_MS);
  } catch {
    return [];
  }
}

function saveRecentReportTimes(email, times) {
  const key = getRateKey(email);
  try {
    localStorage.setItem(key, JSON.stringify(times));
  } catch {
    // ignore
  }
}

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
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const safeContentId = useMemo(() => String(contentId ?? '').trim(), [contentId]);
  const disabled = !safeContentId;

  const selectedReason = useMemo(
    () => REPORT_REASONS.find((r) => r.value === category) || null,
    [category]
  );

  const reporterEmail = useMemo(
    () => normalizeEmail(session?.user?.email),
    [session]
  );

  const checkReportingEligibility = async () => {
    if (!reporterEmail) return { ok: false, reason: 'You need to be logged in to submit a report' };

    // Local anti-abuse gate (can be extended by admin tooling)
    try {
      const stats = await entities.UserReportStats.filter({ user_email: reporterEmail });
      const record = Array.isArray(stats) && stats.length ? stats[0] : null;
      const disabledUntil = record?.reporting_disabled_until ? new Date(record.reporting_disabled_until) : null;
      if (disabledUntil && !Number.isNaN(disabledUntil.getTime())) {
        if (disabledUntil.getTime() > Date.now()) {
          return { ok: false, reason: 'Reporting is temporarily disabled for this account.' };
        }
      }
    } catch {
      // ignore
    }

    const times = loadRecentReportTimes(reporterEmail);
    if (times.length >= RATE_MAX_REPORTS) {
      return { ok: false, reason: 'You’ve submitted several reports recently. Please wait and try again.' };
    }
    return { ok: true };
  };

  const handleSubmit = async () => {
    if (disabled) return;
    if (!category) {
      toast.error('Please select a reason');
      return;
    }

    if (category === 'other' && !String(details || '').trim()) {
      toast.error('Please add a short explanation for “Other”');
      return;
    }

    setSubmitting(true);
    try {
      const eligibility = await checkReportingEligibility();
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
          const res = await uploadFile(evidenceFile, { accessToken });
          evidenceFileUrl = res?.url ? String(res.url) : null;
        } catch (e) {
          console.warn('[ReportButton] evidence upload failed', e);
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

      await createReport(
        {
          reported_content_type: String(contentType),
          reported_content_id: safeContentId,
          report_category: category,
          report_details: details || null,
          evidence_file_url: evidenceFileUrl || undefined,
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
      setEvidenceFile(null);
    } catch (e) {
      logError(e, 'Failed to submit report', { contentType: String(contentType), contentId: safeContentId });
      toast.error(String(e?.message || "Couldn't submit report right now"));
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
            className="relative w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-lg overflow-hidden"
          >
            <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-5 py-4 text-slate-900">
              <div id="report_modal_title" className="font-black text-lg">Report</div>
              <div id="report_modal_desc" className="text-xs font-semibold text-slate-800 mt-1">
                Your identity is kept private from the reported user.
              </div>
            </div>

            <div className="p-5 space-y-3">

            <label className="text-sm font-black text-slate-700">Reason</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
            >
              <option value="">Select…</option>
              {REPORT_REASONS.map((r) => (
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

            <label className="text-sm font-black text-slate-700">
              Explanation (optional)
              {category === 'other' ? <span className="text-rose-700"> *</span> : null}
            </label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full min-h-24 p-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
              placeholder="What happened?"
            />

            <div className="pt-1 space-y-2">
              <label className="text-sm font-black text-slate-700">Evidence file (optional)</label>

              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/gif,application/pdf"
                onChange={(e) => {
                  const file = (e.target.files && e.target.files[0]) || null;
                  e.target.value = '';
                  if (!file) {
                    setEvidenceFile(null);
                    return;
                  }
                  if (file.size > REPORT_MAX_UPLOAD_MB * 1024 * 1024) {
                    toast.error(`File too large. Max size is ${REPORT_MAX_UPLOAD_MB}MB.`);
                    setEvidenceFile(null);
                    return;
                  }
                  if (file.type && !REPORT_ALLOWED_MIME_TYPES.includes(file.type)) {
                    toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF) or PDF.');
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
                disabled={submitting}
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
            </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
