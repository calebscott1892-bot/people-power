import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Lock, Clock, Users, BellOff, AlertCircle } from 'lucide-react';
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { auth, entities } from '@/api/appClient';

export default function ProtectionControls({ movementId, isOwner, className = '' }) {
  const queryClient = useQueryClient();

  const { data: protection } = useQuery({
    queryKey: ['protection', movementId],
    queryFn: async () => {
      const protections = await entities.HarassmentProtection.filter({
        entity_type: 'movement',
        entity_id: movementId
      });
      return protections[0] || null;
    },
    enabled: !!movementId
  });

  const updateProtectionMutation = useMutation({
    mutationFn: async (updates) => {
      if (protection) {
        return entities.HarassmentProtection.update(protection.id, updates);
      } else {
        const user = await auth.me();
        return entities.HarassmentProtection.create({
          entity_type: 'movement',
          entity_id: movementId,
          enabled_by: user.email,
          ...updates
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['protection', movementId] });
      toast.success('Protection settings updated');
    }
  });

  if (!isOwner) {
    const replyRestriction = String(protection?.reply_restriction || 'everyone');
    const slow = protection?.slow_mode_enabled ? `${Number(protection?.slow_mode_seconds || 60)}s` : 'Off';
    const locked = protection?.comments_locked ? 'On' : 'Off';
    const silent = protection?.silent_mode ? 'On' : 'Off';

    return (
      <div className={`p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600 ${className}`}>
        <div className="font-black text-slate-800">Safety tools</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-bold text-slate-500 uppercase">Comments locked</div>
            <div className="text-sm font-black text-slate-900">{locked}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-bold text-slate-500 uppercase">Slow mode</div>
            <div className="text-sm font-black text-slate-900">{slow}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-bold text-slate-500 uppercase">Reply restriction</div>
            <div className="text-sm font-black text-slate-900">{replyRestriction.replace(/_/g, ' ')}</div>
          </div>
          <div className="p-3 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs font-bold text-slate-500 uppercase">Silent mode</div>
            <div className="text-sm font-black text-slate-900">{silent}</div>
          </div>
        </div>
        <div className="mt-2 text-xs font-semibold text-slate-500">Owner-only controls.</div>
      </div>
    );
  }

  const handleToggle = (field, value) => {
    updateProtectionMutation.mutate({ [field]: value });
  };

  return (
    <div className="bg-white rounded-2xl border-3 border-slate-200 p-6 space-y-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
          <Shield className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="font-black text-slate-900">Protection Controls</h3>
          <p className="text-sm text-slate-500 font-semibold">Protect against harassment and dogpiling</p>
        </div>
      </div>

      {protection?.auto_enabled && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-orange-900 text-sm mb-1">Auto-Protection Enabled</p>
            <p className="text-xs text-slate-600">
              Harassment signals detected ({protection.harassment_signals_detected}). 
              Some protections were automatically enabled.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Lock Comments */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="flex items-start gap-3">
            <Lock className="w-5 h-5 text-slate-600 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 text-sm">Lock Comments</p>
              <p className="text-xs text-slate-500">Prevent new comments on this movement</p>
            </div>
          </div>
          <Switch
            checked={protection?.comments_locked || false}
            onCheckedChange={(checked) => handleToggle('comments_locked', checked)}
            disabled={updateProtectionMutation.isPending}
          />
        </div>

        {/* Slow Mode */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="flex items-start gap-3 flex-1">
            <Clock className="w-5 h-5 text-slate-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-slate-900 text-sm">Slow Mode</p>
              <p className="text-xs text-slate-500 mb-2">Rate limit comments to prevent spam</p>
              {protection?.slow_mode_enabled && (
                <Select
                  value={String(protection?.slow_mode_seconds || 60)}
                  onValueChange={(value) => handleToggle('slow_mode_seconds', parseInt(value))}
                >
                  <SelectTrigger className="w-32 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="60">1 minute</SelectItem>
                    <SelectItem value="120">2 minutes</SelectItem>
                    <SelectItem value="300">5 minutes</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <Switch
            checked={protection?.slow_mode_enabled || false}
            onCheckedChange={(checked) => handleToggle('slow_mode_enabled', checked)}
            disabled={updateProtectionMutation.isPending}
          />
        </div>

        {/* Reply Restrictions */}
        <div className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="flex items-start gap-3 mb-3">
            <Users className="w-5 h-5 text-slate-600 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-slate-900 text-sm">Reply Restrictions</p>
              <p className="text-xs text-slate-500">Control who can comment</p>
            </div>
          </div>
          <Select
            value={protection?.reply_restriction || 'everyone'}
            onValueChange={(value) => handleToggle('reply_restriction', value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="everyone">Everyone can reply</SelectItem>
              <SelectItem value="followers_only">Followers only</SelectItem>
              <SelectItem value="collaborators_only">Collaborators only</SelectItem>
              <SelectItem value="disabled">Replies disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Silent Mode */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="flex items-start gap-3">
            <BellOff className="w-5 h-5 text-slate-600 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900 text-sm">Silent Mode</p>
              <p className="text-xs text-slate-500">Movement stays live but stops sending notifications</p>
            </div>
          </div>
          <Switch
            checked={protection?.silent_mode || false}
            onCheckedChange={(checked) => handleToggle('silent_mode', checked)}
            disabled={updateProtectionMutation.isPending}
          />
        </div>
      </div>
    </div>
  );
}