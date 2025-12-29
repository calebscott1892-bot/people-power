import React, { useState } from 'react';
import { Upload, X, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { motion, AnimatePresence } from 'framer-motion';
import { integrations } from '@/api/appClient';

export default function EvidenceUploader({ evidence, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [acknowledged, setAcknowledged] = useState(evidence.user_acknowledges_unverified || false);
  const MAX_UPLOAD_MB = 5;
  const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'application/pdf'];

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
        return;
      }
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF) or PDF.');
        return;
      }
    }

    setUploading(true);
    try {
      const uploadPromises = files.map((file) => integrations.Core.UploadFile({ file }));
      const results = await Promise.all(uploadPromises);
      
      const newUrls = results.map(r => r.file_url);
      onChange({
        ...evidence,
        evidence_urls: [...(evidence.evidence_urls || []), ...newUrls],
        evidence_descriptions: [...(evidence.evidence_descriptions || []), ...files.map(f => f.name)]
      });
      
      toast.success('Evidence uploaded');
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removeEvidence = (index) => {
    const newUrls = [...evidence.evidence_urls];
    const newDescs = [...evidence.evidence_descriptions];
    newUrls.splice(index, 1);
    newDescs.splice(index, 1);
    onChange({
      ...evidence,
      evidence_urls: newUrls,
      evidence_descriptions: newDescs
    });
  };

  const updateDescription = (index, desc) => {
    const newDescs = [...evidence.evidence_descriptions];
    newDescs[index] = desc;
    onChange({
      ...evidence,
      evidence_descriptions: newDescs
    });
  };

  return (
    <div className="space-y-4">
      {/* Critical Disclaimer */}
      <div className="p-4 bg-red-50 border-3 border-red-300 rounded-xl">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-black text-red-900 text-sm mb-2">IMPORTANT: Evidence Disclaimer</p>
            <ul className="space-y-1 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span><strong>All evidence is user-submitted and NOT verified by the platform</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>The platform does not confirm, endorse, or validate any claims</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>Uploading evidence does not make claims &quot;verified&quot; or &quot;proven&quot;</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-600 font-black">•</span>
                <span>Viewers should independently verify all information</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="acknowledge"
            checked={acknowledged}
            onCheckedChange={(checked) => {
              setAcknowledged(checked);
              onChange({ ...evidence, user_acknowledges_unverified: checked });
            }}
          />
          <label htmlFor="acknowledge" className="text-xs text-slate-700 font-bold cursor-pointer">
            I understand that evidence I upload is unverified, and the platform makes no claims about its authenticity or accuracy
          </label>
        </div>
      </div>

      {/* Upload Button */}
      <div>
        <input
          type="file"
          id="evidence-upload"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.gif"
          onChange={handleFileUpload}
          className="hidden"
          disabled={!acknowledged || uploading}
        />
        <label htmlFor="evidence-upload">
          <Button
            type="button"
            disabled={!acknowledged || uploading}
            className="w-full h-12 rounded-xl font-bold border-2 border-dashed"
            variant="outline"
            onClick={() => document.getElementById('evidence-upload').click()}
          >
            {uploading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 mr-2" />
                Attach Evidence (Optional)
              </>
            )}
          </Button>
        </label>
        <p className="text-xs text-slate-500 mt-2 text-center">
          PDF or image (JPG/PNG/GIF) • Max {MAX_UPLOAD_MB}MB per file
        </p>
      </div>

      {/* Uploaded Evidence */}
      <AnimatePresence>
        {evidence.evidence_urls && evidence.evidence_urls.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <p className="text-sm font-bold text-slate-700">Attached Evidence:</p>
            {evidence.evidence_urls.map((url, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-xl border-2 border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1">
                    <FileText className="w-4 h-4 text-slate-600" />
                    <span className="text-sm font-semibold text-slate-700 truncate">
                      {evidence.evidence_descriptions?.[idx] || `Evidence ${idx + 1}`}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeEvidence(idx)}
                    className="h-8 w-8 p-0"
                    aria-label={`Remove evidence ${idx + 1}`}
                    title="Remove evidence"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                <Input
                  placeholder="Add description (what does this evidence show?)"
                  value={evidence.evidence_descriptions?.[idx] || ''}
                  onChange={(e) => updateDescription(idx, e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
