import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Upload, Loader2, CheckCircle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { integrations } from "@/api/appClient";
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';

export default function CompletionModal({ challenge, onClose, onComplete }) {
  const [evidenceType, setEvidenceType] = useState('none');
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceImage, setEvidenceImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef(null);
  const MAX_UPLOAD_MB = 5;
  const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];

  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, []);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
        return;
      }
      if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
        toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF).');
        return;
      }
      setEvidenceImage(file);
      setImagePreview(URL.createObjectURL(file));
      setEvidenceType('image');
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    
    try {
      let imageUrl = null;
      if (evidenceImage) {
        const upload = await integrations.Core.UploadFile({ file: evidenceImage });
        imageUrl = upload.file_url;
      }

      await onComplete({
        evidence_type: evidenceType,
        evidence_text: evidenceText || null,
        evidence_image_url: imageUrl
      });

      toast.success('Challenge completed! 🎉');
      onClose();
    } catch {
      toast.error('Failed to complete challenge');
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        role="presentation"
        onKeyDown={(e) => {
          trapFocusKeyDown(e, dialogRef.current);
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose?.();
          }
        }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="completion_modal_title"
          aria-describedby="completion_modal_desc"
          tabIndex={-1}
          initial={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: reduceMotion ? 0 : undefined }}
          className="bg-white rounded-3xl max-w-2xl w-full p-8 shadow-2xl border-3 border-slate-200 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 id="completion_modal_title" className="text-3xl font-black text-slate-900 mb-2">
                Complete Challenge
              </h2>
              <p id="completion_modal_desc" className="text-slate-600 font-semibold">
                {challenge.title}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-xl transition-colors"
              aria-label="Close"
              title="Close"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Evidence Options */}
          <div className="space-y-6 mb-8">
            <div>
              <label className="block text-sm font-black text-slate-900 uppercase tracking-wider mb-3">
                Add Evidence (Optional)
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setEvidenceType('none')}
                  aria-pressed={evidenceType === 'none'}
                  className={`p-4 rounded-xl border-2 font-bold text-center transition-all ${
                    evidenceType === 'none'
                      ? 'border-[#3A3DFF] bg-indigo-50 text-[#3A3DFF]'
                      : 'border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => setEvidenceType('text')}
                  aria-pressed={evidenceType === 'text'}
                  className={`p-4 rounded-xl border-2 font-bold text-center transition-all ${
                    evidenceType === 'text'
                      ? 'border-[#3A3DFF] bg-indigo-50 text-[#3A3DFF]'
                      : 'border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  Description
                </button>
                <button
                  type="button"
                  onClick={() => setEvidenceType('image')}
                  aria-pressed={evidenceType === 'image'}
                  className={`p-4 rounded-xl border-2 font-bold text-center transition-all ${
                    evidenceType === 'image'
                      ? 'border-[#3A3DFF] bg-indigo-50 text-[#3A3DFF]'
                      : 'border-slate-300 text-slate-600 hover:border-slate-400'
                  }`}
                >
                  Photo
                </button>
              </div>
            </div>

            {/* Text Evidence */}
            {evidenceType === 'text' && (
              <motion.div
                initial={reduceMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: reduceMotion ? 0 : undefined }}
              >
                <Textarea
                  value={evidenceText}
                  onChange={(e) => setEvidenceText(e.target.value)}
                  placeholder="Describe what you did..."
                  className="min-h-[120px] rounded-2xl border-3 border-slate-300 focus:border-[#3A3DFF]"
                />
              </motion.div>
            )}

            {/* Image Evidence */}
            {evidenceType === 'image' && (
              <motion.div
                initial={reduceMotion ? { opacity: 1, height: 'auto' } : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: reduceMotion ? 0 : undefined }}
                className="space-y-4"
              >
                <div className="border-3 border-dashed border-slate-300 rounded-2xl p-8 text-center hover:border-[#3A3DFF] transition-colors">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                    id="image-upload"
                  />
                  <label
                    htmlFor="image-upload"
                    className="cursor-pointer flex flex-col items-center gap-3"
                  >
                    <Upload className="w-12 h-12 text-slate-400" />
                    <span className="font-bold text-slate-700">
                      Click to upload photo
                    </span>
                  </label>
                </div>
                {imagePreview && (
                  <div className="relative rounded-2xl overflow-hidden border-3 border-slate-200">
                    <img
                      src={imagePreview}
                      alt="Evidence preview"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-indigo-50 rounded-2xl p-4 mb-6 border-2 border-indigo-200">
            <p className="text-sm text-slate-700 leading-relaxed">
              <strong>🟢 Verified badges</strong> are awarded when you provide evidence.
              Evidence helps build trust in the community!
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={onClose}
              variant="outline"
              className="flex-1 h-14 rounded-xl border-2 border-slate-300 font-bold uppercase tracking-wide"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || (evidenceType === 'text' && !evidenceText.trim()) || (evidenceType === 'image' && !evidenceImage)}
              className="flex-1 h-14 bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 rounded-xl font-black shadow-xl uppercase tracking-wide"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Completing...
                </>
              ) : (
                <>
                  <CheckCircle className="w-5 h-5 mr-2" />
                  Complete Challenge
                </>
              )}
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
