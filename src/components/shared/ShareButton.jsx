import React, { useMemo, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ExternalLink, Link as LinkIcon, Share2 } from 'lucide-react';
import { toast } from "sonner";
import { useAuth } from '@/auth/AuthProvider';
import { createConversation, sendMessage } from '@/api/messagesClient';
import { fetchPublicKey, upsertMyPublicKey } from '@/api/keysClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NEW_MOVEMENT_EXTERNAL_SHARE_COOLDOWN_MS = 15 * 60 * 1000;

export default function ShareButton({ movement, variant = "default" }) {
  const { user, session } = useAuth();
  const [showDialog, setShowDialog] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingDm, setSendingDm] = useState(false);

  const e2eePromiseRef = useRef(null);
  const loadE2EE = async () => {
    if (!e2eePromiseRef.current) {
      e2eePromiseRef.current = Promise.all([
        import('@/lib/e2eeCrypto'),
        import('@/lib/e2eeFormat'),
      ]).then(([crypto, format]) => ({ ...crypto, ...format }));
    }
    return e2eePromiseRef.current;
  };

  const movementCreatedAt = movement?.created_at || movement?.created_date || movement?.createdAt || null;
  const movementAgeMs = useMemo(() => {
    if (!movementCreatedAt) return null;
    const t = new Date(movementCreatedAt).getTime();
    if (!Number.isFinite(t)) return null;
    return Date.now() - t;
  }, [movementCreatedAt]);

  const externalShareRemainingMs = useMemo(() => {
    if (movementAgeMs === null) return 0;
    return Math.max(0, NEW_MOVEMENT_EXTERNAL_SHARE_COOLDOWN_MS - movementAgeMs);
  }, [movementAgeMs]);

  const externalShareLocked = externalShareRemainingMs > 0;
  const externalShareRemainingLabel = useMemo(() => {
    if (!externalShareLocked) return '';
    const minutes = Math.max(1, Math.ceil(externalShareRemainingMs / (60 * 1000)));
    return `${minutes} min`;
  }, [externalShareLocked, externalShareRemainingMs]);

  const safeMovementId = movement?.id ?? movement?._id ?? null;
  const shareUrl = useMemo(() => {
    try {
      if (!safeMovementId) return window.location.href;
      return `${window.location.origin}/movements/${encodeURIComponent(String(safeMovementId))}`;
    } catch {
      return '';
    }
  }, [safeMovementId]);

  const shareTitle = String(movement?.title || movement?.name || 'Movement');
  const shareDesc = String(movement?.description || movement?.summary || '').trim();
  const shareText = shareDesc
    ? `${shareDesc.substring(0, 140)}${shareDesc.length > 140 ? '…' : ''}`
    : '';

  const handleCopyLink = async () => {
    try {
      if (!shareUrl) {
        toast.error('Could not generate a share link');
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Link copied!');
      setShowDialog(false);
    } catch (e) {
      console.warn('[ShareButton] copy link failed', e);
      toast.error("Couldn't copy link right now");
    }
  };

  const handleShareToDm = async () => {
    const accessToken = session?.access_token ? String(session.access_token) : null;
    const myEmail = user?.email ? String(user.email) : '';
    const to = String(recipientEmail || '').trim().toLowerCase();

    if (!accessToken || !myEmail) {
      toast.error('Please log in to share via DM');
      return;
    }
    if (!to) {
      toast.error('Recipient email is required');
      return;
    }
    if (!shareUrl) {
      toast.error('Could not generate a share link');
      return;
    }

    setSendingDm(true);
    try {
      const {
        deriveSharedSecretKey,
        encryptText,
        getOrCreateIdentityKeypair,
        packEncryptedPayload,
      } = await loadE2EE();

      // Ensure my public key is published.
      const kp = await getOrCreateIdentityKeypair(myEmail);
      await upsertMyPublicKey(kp.publicKey, { accessToken });

      const otherPublicKey = await fetchPublicKey(to, { accessToken });
      const key = await deriveSharedSecretKey(kp.privateKey, otherPublicKey);
      const plaintext = [shareTitle, shareUrl].filter(Boolean).join('\n');
      const encrypted = await encryptText(plaintext, key);
      const packed = packEncryptedPayload(encrypted);

      const convo = await createConversation(to, { accessToken });
      if (!convo?.id) throw new Error('Failed to create conversation');
      await sendMessage(String(convo.id), packed, { accessToken });

      toast.success('Shared via DM');
      setDmOpen(false);
      setRecipientEmail('');
      setShowDialog(false);
    } catch (e) {
      console.warn('[ShareButton] share-to-dm failed', e);
      toast.error(String(e?.message || 'Failed to share via DM'));
    } finally {
      setSendingDm(false);
    }
  };

  const handleExternalShare = async () => {
    try {
      if (!shareUrl) {
        toast.error('Could not generate a share link');
        return;
      }

      if (externalShareLocked) {
        toast.message(`External sharing unlocks in ${externalShareRemainingLabel} (anti-spam cooldown).`);
        return;
      }

      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      } else {
        toast.message('On supported devices, this uses the native share sheet (AirDrop/Instagram/etc).');
        await handleCopyLink();
        return; // handleCopyLink already closes dialog
      }

      setShowDialog(false);
    } catch (e) {
      console.warn('[ShareButton] external share failed', e);
      // Fallback: try copy link
      await handleCopyLink();
    }
  };

  const openUrl = (url) => {
    try {
      if (externalShareLocked) {
        toast.message(`External sharing unlocks in ${externalShareRemainingLabel} (anti-spam cooldown).`);
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      setShowDialog(false);
    } catch (e) {
      console.warn('[ShareButton] openUrl failed', e);
      toast.error("Couldn't open share target");
    }
  };

  const encodedUrl = encodeURIComponent(shareUrl || window.location.href);
  const encodedText = encodeURIComponent([shareTitle, shareText].filter(Boolean).join('\n\n'));

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        variant={variant}
        className="font-bold rounded-xl"
      >
        <Share2 className="w-4 h-4 mr-2" />
        Share
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Share Movement</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            <Button
              onClick={() => {
                if (!user) {
                  toast.error('Please log in to share via DM');
                  return;
                }
                setDmOpen(true);
              }}
              variant="outline"
              className="w-full h-14 justify-start border-2 rounded-xl font-bold"
            >
              <Share2 className="w-5 h-5 mr-3" />
              Share to DM
            </Button>

            <Button
              onClick={handleCopyLink}
              variant="outline"
              className="w-full h-14 justify-start border-2 rounded-xl font-bold"
            >
              <LinkIcon className="w-5 h-5 mr-3" />
              Copy Link
            </Button>

            <Button
              onClick={handleExternalShare}
              variant="outline"
              className="w-full h-14 justify-start border-2 rounded-xl font-bold"
              title="Uses your device's native share sheet when available (AirDrop/Instagram/Messages/etc)"
              disabled={externalShareLocked}
            >
              <Share2 className="w-5 h-5 mr-3" />
              Share via device (AirDrop / Instagram)
              {externalShareLocked ? (
                <span className="ml-auto text-xs font-black text-slate-600">Cooldown {externalShareRemainingLabel}</span>
              ) : null}
            </Button>

            <div className="border-t-2 border-slate-200 pt-3 mt-4 space-y-2">
              <p className="text-sm font-bold text-slate-700 mb-1">More options</p>

              <Button
                onClick={() => openUrl(`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`)}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share to X
              </Button>

              <Button
                onClick={() => openUrl(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share to Facebook
              </Button>

              <Button
                onClick={() => openUrl(`https://wa.me/?text=${encodedText}%0A%0A${encodedUrl}`)}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share to WhatsApp
              </Button>

              <Button
                onClick={() => openUrl(`https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`)}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share to Telegram
              </Button>

              <Button
                onClick={() => {
                  const subject = encodeURIComponent(shareTitle);
                  const body = encodeURIComponent([shareText, shareUrl].filter(Boolean).join('\n\n'));
                  openUrl(`mailto:?subject=${subject}&body=${body}`);
                }}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share via Email
              </Button>

              <Button
                onClick={() => {
                  const body = encodeURIComponent([shareText, shareUrl].filter(Boolean).join('\n\n'));
                  // "sms:" URL support varies by platform; this is a best-effort.
                  if (externalShareLocked) {
                    toast.message(`External sharing unlocks in ${externalShareRemainingLabel} (anti-spam cooldown).`);
                    return;
                  }
                  window.location.href = `sms:?&body=${body}`;
                  setShowDialog(false);
                }}
                variant="outline"
                className="w-full h-12 justify-start border-2 rounded-xl font-bold"
                disabled={externalShareLocked}
              >
                <ExternalLink className="w-4 h-4 mr-3" />
                Share via SMS
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dmOpen} onOpenChange={setDmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Share to DM</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-3">
            <div className="text-sm font-bold text-slate-700">Recipient email</div>
            <input
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-semibold"
            />

            <div className="text-xs text-slate-500 font-semibold">
              This sends an end-to-end encrypted message containing the movement link.
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setDmOpen(false)} className="rounded-xl font-bold">
                Cancel
              </Button>
              <Button
                onClick={handleShareToDm}
                disabled={sendingDm}
                className="rounded-xl font-bold bg-[#3A3DFF] hover:bg-[#2A2DDD]"
              >
                {sendingDm ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}