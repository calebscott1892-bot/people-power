import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Gift, Sparkles } from 'lucide-react';
import { toast } from "sonner";

export default function GiftPointsModal({ open, onClose, toUser, userStats, onGift }) {
  const [amount, setAmount] = useState(10);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const maxGiftable = Math.floor(userStats.total_points * 0.2); // Can gift up to 20% of points

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (amount < 5) {
      toast.error('Minimum gift is 5 points');
      return;
    }
    
    if (amount > maxGiftable) {
      toast.error(`You can gift up to ${maxGiftable} points (20% of your total)`);
      return;
    }

    setIsSubmitting(true);
    await onGift({ amount, message });
    setIsSubmitting(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Gift className="w-6 h-6 text-[#FFC947]" />
            Gift Expression Points
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="bg-indigo-50 rounded-xl p-4 border-2 border-indigo-200">
            <p className="text-sm text-slate-700 font-semibold mb-2">
              Gifting to: <span className="text-[#3A3DFF] font-black">{toUser?.display_name || 'Anonymous'}</span>
            </p>
            <p className="text-xs text-slate-500">
              Help others unlock profile customization and flair!
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Points Amount</label>
            <Input
              type="number"
              min="5"
              max={maxGiftable}
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
              className="text-lg font-bold"
            />
            <p className="text-xs text-slate-500">
              You have {userStats.total_points} points. You can gift up to {maxGiftable} points.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Message (Optional)</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Add a kind message..."
              className="resize-none h-20"
              maxLength={200}
            />
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || amount < 5 || amount > maxGiftable}
              className="flex-1 bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 font-bold"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Send Gift
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}