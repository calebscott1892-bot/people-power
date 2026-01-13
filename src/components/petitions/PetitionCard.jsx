import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Target, Calendar, CheckCircle, Pen } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { entities } from "@/api/appClient";
import { focusFirstInteractive, trapFocusKeyDown } from '@/components/utils/focusTrap';
import { logError } from '@/utils/logError';

export default function PetitionCard({ petition, currentUser, isPast = false }) {
  const [showSignModal, setShowSignModal] = useState(false);
  const [comment, setComment] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const signDialogRef = useRef(null);

  useEffect(() => {
    if (!showSignModal) return;
    const root = signDialogRef.current;
    if (!root) return;
    focusFirstInteractive(root);
  }, [showSignModal]);

  const { data: hasSigned } = useQuery({
    queryKey: ['localSignature', petition.id, currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return false;
      const sigs = await entities.PetitionSignature.filter(
        {
          petition_id: petition.id,
          user_email: currentUser.email,
        },
        null,
        { limit: 1, offset: 0, fields: 'id' }
      );
      return Array.isArray(sigs) && sigs.length > 0;
    },
    enabled: !!currentUser && !!petition.id
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      await entities.PetitionSignature.create({
        petition_id: petition.id,
        user_email: currentUser.email,
        user_name: currentUser.full_name || currentUser.email,
        comment: comment.trim() || null,
        is_public: isPublic
      });

      await entities.Petition.update(petition.id, {
        signature_count: (petition.signature_count || 0) + 1
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localSignature'] });
      queryClient.invalidateQueries({ queryKey: ['localPetitions'] });
      setShowSignModal(false);
      toast.success('Petition signed!');
    },
    onError: (e) => {
      logError(e, 'Petition sign failed', { petitionId: petition?.id });
      toast.error('Could not sign petition. Please try again.');
    },
  });

  const signatureCount = Number(petition?.signature_count || 0) || 0;
  const signatureGoal = Number(petition?.signature_goal || 0) || 0;
  const progress = signatureGoal > 0 ? Math.min((signatureCount / signatureGoal) * 100, 100) : 0;

  return (
    <>
      <div className={cn(
        "bg-white rounded-2xl p-6 border-2 border-slate-200 hover:border-[#3A3DFF] transition-all",
        isPast && "opacity-60"
      )}>
        <div className="flex items-start gap-4 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-xl flex items-center justify-center flex-shrink-0">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-lg font-black text-slate-900 mb-2">{petition.title}</h4>
            <p className="text-sm text-slate-600 mb-3 line-clamp-2">{petition.description}</p>
            
            <div className="flex items-center gap-4 text-sm text-slate-500 mb-4">
              <div className="flex items-center gap-1">
                <Target className="w-4 h-4" />
                <span className="font-bold">{petition.target_audience}</span>
              </div>
              {petition.deadline && (
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  <span className="font-bold">Due {format(new Date(petition.deadline), 'MMM d')}</span>
                </div>
              )}
            </div>

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-black text-[#3A3DFF]">
                  {signatureCount.toLocaleString()} signatures
                </span>
                <span className="font-bold text-slate-500">
                  {signatureGoal > 0 ? `Goal: ${signatureGoal.toLocaleString()}` : 'No goal set'}
                </span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: reduceMotion ? `${progress}%` : 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: reduceMotion ? 0 : 1, ease: "easeOut" }}
                  className="h-full bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF]"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1 font-bold">
                {signatureGoal > 0 ? `${progress.toFixed(1)}% of goal` : 'Set a goal to track progress'}
              </p>
            </div>

            {!isPast && currentUser && !hasSigned && (
              <Button
                onClick={() => setShowSignModal(true)}
                className="w-full bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
              >
                <Pen className="w-4 h-4 mr-2" />
                Sign Petition
              </Button>
            )}

            {hasSigned && (
              <div className="flex items-center gap-2 text-green-600 font-bold text-sm">
                <CheckCircle className="w-5 h-5" />
                You signed this petition
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sign Modal */}
      <AnimatePresence>
        {showSignModal && (
          <motion.div
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : undefined }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowSignModal(false)}
            role="presentation"
            onKeyDown={(e) => {
              trapFocusKeyDown(e, signDialogRef.current);
              if (e.key === 'Escape') {
                e.stopPropagation();
                setShowSignModal(false);
              }
            }}
          >
            <motion.div
              ref={signDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="petition_sign_title"
              tabIndex={-1}
              initial={reduceMotion ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduceMotion ? { scale: 1, opacity: 1 } : { scale: 0.9, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : undefined }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl p-6 max-w-md w-full"
            >
              <h3 id="petition_sign_title" className="text-xl font-black text-slate-900 mb-4">Sign Petition</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    Add a comment (optional)
                  </label>
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Why does this matter to you?"
                    className="rounded-xl border-2 min-h-[100px]"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <input
                    id="petition_signature_public"
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="w-5 h-5 rounded accent-[#3A3DFF]"
                  />
                  <label htmlFor="petition_signature_public" className="text-sm text-slate-700 font-bold">
                    Make my signature public
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => setShowSignModal(false)}
                    variant="outline"
                    className="flex-1 rounded-xl font-bold border-2"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => signMutation.mutate()}
                    disabled={signMutation.isPending}
                    className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
                  >
                    {signMutation.isPending ? 'Signing...' : 'Sign Now'}
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function PetitionCardDisabled() {
  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
      Petitions are not available here.
    </div>
  );
}
