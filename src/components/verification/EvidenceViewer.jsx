import React from 'react';
import { FileText, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";

export default function EvidenceViewer({ evidence }) {
  if (!evidence || !evidence.evidence_urls || evidence.evidence_urls.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Critical Disclaimer */}
      <div className="p-4 bg-red-50 border-3 border-red-300 rounded-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-black text-red-900 text-sm mb-2">⚠️ USER-SUBMITTED EVIDENCE - NOT VERIFIED</p>
            <ul className="space-y-1 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>This evidence was uploaded by the movement creator and <strong>has not been verified by the platform</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>The platform makes no claims about authenticity, accuracy, or validity</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>You should independently verify all information before acting on it</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>Presence of evidence does not mean claims are &quot;proven&quot; or &quot;confirmed&quot;</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Evidence Files */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-slate-700">Attached Evidence ({evidence.evidence_urls.length}):</p>
        {evidence.evidence_urls.map((url, idx) => (
          <div key={idx} className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1">
                <div className="w-10 h-10 bg-slate-200 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-slate-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-sm mb-1 truncate">
                    {evidence.evidence_descriptions?.[idx] || `Evidence ${idx + 1}`}
                  </p>
                  <p className="text-xs text-slate-500">User-submitted • Unverified</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.open(url, '_blank')}
                className="rounded-xl flex-shrink-0"
              >
                <ExternalLink className="w-4 h-4 mr-1" />
                View
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Warning */}
      <div className="p-3 bg-orange-50 border-2 border-orange-200 rounded-xl">
        <p className="text-xs text-slate-700 font-bold text-center">
          ⚠️ Always verify information independently before taking action
        </p>
      </div>
    </div>
  );
}