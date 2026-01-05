import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { createReport } from '@/api/reportsClient';
import { uploadFile } from '@/api/uploadsClient';
import { ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES, validateFileUpload } from '@/utils/uploadLimits';
import { toastFriendlyError } from '@/utils/toastErrors';

function getClientInfo() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const screenObj = typeof screen !== 'undefined' ? screen : null;
    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        return null;
      }
    })();

    return {
      userAgent: nav?.userAgent || null,
      platform: nav?.platform || null,
      language: nav?.language || null,
      languages: Array.isArray(nav?.languages) ? nav.languages : null,
      viewport: typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : null,
      screen: screenObj ? { width: screenObj.width, height: screenObj.height, pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : null } : null,
      timezone: tz,
    };
  } catch {
    return {};
  }
}

function formatClientInfoBlock(info, url) {
  const safeUrl = url ? String(url) : '';
  const lines = [];
  if (safeUrl) lines.push(`url: ${safeUrl}`);
  if (info?.timezone) lines.push(`timezone: ${info.timezone}`);
  if (info?.language) lines.push(`language: ${info.language}`);
  if (info?.platform) lines.push(`platform: ${info.platform}`);
  if (info?.viewport?.width && info?.viewport?.height) {
    lines.push(`viewport: ${info.viewport.width}x${info.viewport.height}`);
  }
  if (info?.screen?.width && info?.screen?.height) {
    const dpr = info?.screen?.pixelRatio ? ` @${info.screen.pixelRatio}x` : '';
    lines.push(`screen: ${info.screen.width}x${info.screen.height}${dpr}`);
  }
  if (info?.userAgent) lines.push(`userAgent: ${info.userAgent}`);
  return lines.join('\n');
}

async function captureViewportPngFile() {
  const html2canvas = (await import('html2canvas')).default;

  const canvas = await html2canvas(document.documentElement, {
    logging: false,
    useCORS: true,
    backgroundColor: null,
    width: window.innerWidth,
    height: window.innerHeight,
    x: window.scrollX,
    y: window.scrollY,
  });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Failed to capture screenshot');
  return new File([blob], `peoplepower-screenshot-${Date.now()}.png`, { type: 'image/png' });
}

export default function FeedbackBugDialog({ open, onOpenChange }) {
  const { session } = useAuth();
  const location = useLocation();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const reporterEmail = session?.user?.email ? String(session.user.email) : null;

  const [mode, setMode] = useState('feedback'); // 'feedback' | 'bug'
  const [bugTitle, setBugTitle] = useState('');
  const [reproSteps, setReproSteps] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setMode('feedback');
    setBugTitle('');
    setReproSteps('');
    setIncludeScreenshot(false);
    setScreenshotFile(null);
    setCapturing(false);
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (mode !== 'bug') {
      setBugTitle('');
    }
  }, [mode]);

  const currentUrl = useMemo(() => {
    try {
      const base = typeof window !== 'undefined' ? window.location.origin : '';
      const path = location?.pathname || '/';
      const search = location?.search || '';
      return `${base}${path}${search}`;
    } catch {
      return location?.pathname || '/';
    }
  }, [location?.pathname, location?.search]);

  const screenshotLabel = useMemo(() => {
    if (!screenshotFile) return null;
    const kb = typeof screenshotFile.size === 'number' ? Math.round(screenshotFile.size / 1024) : null;
    return kb ? `${screenshotFile.name} (${kb}KB)` : screenshotFile.name;
  }, [screenshotFile]);

  const handleCapture = async () => {
    if (!includeScreenshot) return;
    setCapturing(true);
    try {
      const file = await captureViewportPngFile();
      const validation = validateFileUpload({
        file,
        maxBytes: MAX_UPLOAD_BYTES,
        allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
      });
      if (validation) {
        toast.error(validation);
        return;
      }
      setScreenshotFile(file);
      toast.success('Screenshot captured');
    } catch (e) {
      toastFriendlyError(e, 'Could not capture screenshot');
    } finally {
      setCapturing(false);
    }
  };

  const handleSubmit = async () => {
    if (!reporterEmail || !accessToken) {
      toast.error('Please sign in to send feedback.');
      return;
    }

    const steps = String(reproSteps || '').trim();
    if (!steps) {
      toast.error('Please add repro steps.');
      return;
    }

    const isBug = mode === 'bug';
    const title = String(bugTitle || '').trim();
    if (isBug && !title) {
      toast.error('Please add a short bug title.');
      return;
    }

    if (includeScreenshot && !screenshotFile) {
      toast.error('Capture a screenshot or uncheck it.');
      return;
    }

    setSubmitting(true);
    try {
      let evidenceUrl = null;
      if (includeScreenshot && screenshotFile) {
        const res = await uploadFile(screenshotFile, {
          accessToken,
          maxBytes: MAX_UPLOAD_BYTES,
          allowedMimeTypes: ALLOWED_UPLOAD_MIME_TYPES,
        });
        evidenceUrl = res?.url ? String(res.url) : null;
      }

      const clientInfo = getClientInfo();
      const clientBlock = formatClientInfoBlock(clientInfo, currentUrl);

      const details = [
        steps,
        '',
        '---',
        'Client info:',
        clientBlock,
      ].join('\n');

      await createReport(
        {
          report_type: isBug ? 'bug' : 'feedback',
          report_title: isBug ? title : null,
          reported_content_type: 'app',
          reported_content_id: currentUrl || '/',
          report_category: isBug ? 'bug' : 'feedback',
          report_details: details,
          ...(evidenceUrl ? { evidence_urls: [evidenceUrl] } : {}),
        },
        { accessToken, reporterEmail }
      );

      toast.success(isBug ? 'Bug report sent. Thank you.' : 'Feedback sent. Thank you.');
      onOpenChange(false);
    } catch (e) {
      toastFriendlyError(e, "Couldn't submit right now");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Send feedback / report a bug</DialogTitle>
          <DialogDescription>
            We’ll attach device and browser info automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'feedback' ? 'default' : 'outline'}
            className="font-bold"
            onClick={() => setMode('feedback')}
            disabled={submitting || capturing}
          >
            Send feedback
          </Button>
          <Button
            type="button"
            variant={mode === 'bug' ? 'default' : 'outline'}
            className="font-bold"
            onClick={() => setMode('bug')}
            disabled={submitting || capturing}
          >
            Report bug
          </Button>
        </div>

        {mode === 'bug' ? (
          <div className="space-y-2">
            <div className="text-sm font-bold text-slate-700">Bug title</div>
            <Input
              value={bugTitle}
              onChange={(e) => setBugTitle(e.target.value)}
              placeholder="Short summary"
              disabled={submitting || capturing}
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-sm font-bold text-slate-700">Repro steps</div>
          <Textarea
            value={reproSteps}
            onChange={(e) => setReproSteps(e.target.value)}
            placeholder="1) What did you do?\n2) What did you expect?\n3) What happened instead?"
            disabled={submitting || capturing}
            className="min-h-[140px]"
          />
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="include-screenshot"
            checked={includeScreenshot}
            onCheckedChange={(v) => {
              const next = v === true;
              setIncludeScreenshot(next);
              if (!next) setScreenshotFile(null);
            }}
            disabled={submitting || capturing}
          />
          <div className="flex-1">
            <label htmlFor="include-screenshot" className="text-sm font-bold text-slate-700">
              Include screenshot (optional)
            </label>
            {includeScreenshot ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="font-bold"
                  onClick={handleCapture}
                  disabled={submitting || capturing}
                >
                  {capturing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Capturing…
                    </span>
                  ) : (
                    'Capture screenshot'
                  )}
                </Button>
                {screenshotLabel ? (
                  <span className="text-xs font-semibold text-slate-600">{screenshotLabel}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting || capturing}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || capturing} className="font-bold">
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending…
              </span>
            ) : mode === 'bug' ? (
              'Report bug'
            ) : (
              'Send feedback'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
