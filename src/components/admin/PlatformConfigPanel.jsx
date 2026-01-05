import React, { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings, Save, Shield, Sparkles } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { toastFriendlyError } from '@/utils/toastErrors';
import { entities } from "@/api/appClient";
import { useAuth } from '@/auth/AuthProvider';
import { isAdmin as isAdminEmail } from '@/utils/staff';

const DEFAULT_POWER_LIMITS = {
  max_movements_created: 5,
  max_collaborator_roles: 10,
  max_events_organized: 8,
  max_petitions_created: 5
};

const DEFAULT_AI_SETTINGS = {
  show_ai_indicators: true,
  sanitize_prescriptive_language: true,
  block_moral_judgments: true,
  show_uncertainty_warnings: true
};

export default function PlatformConfigPanel({ adminEmail }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const authedEmail = user?.email ? String(user.email) : '';
  const effectiveAdminEmail = authedEmail || (adminEmail ? String(adminEmail) : '');
  const isAdmin = isAdminEmail(effectiveAdminEmail);

  const { data: configs = [] } = useQuery({
    queryKey: ['platformConfigs'],
    enabled: isAdmin,
    queryFn: () => entities.PlatformConfig.list()
  });

  const updateConfigMutation = useMutation({
    mutationFn: async ({ key, value, category, description }) => {
      if (!isAdmin) throw new Error('Admin access required');
      const existing = configs.find(c => c.config_key === key);
      
      if (existing) {
        return entities.PlatformConfig.update(existing.id, {
          config_value: value,
          last_modified_by: effectiveAdminEmail
        });
      } else {
        return entities.PlatformConfig.create({
          config_key: key,
          config_value: value,
          category: category,
          description: description,
          last_modified_by: effectiveAdminEmail
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platformConfigs'] });
      toast.success('Configuration updated');
    },
    onError: (e) => {
      toastFriendlyError(e, 'Failed to update configuration');
    }
  });

  const getConfigValue = useCallback(
    (key, defaultValue) => {
      const config = configs.find((c) => c.config_key === key);
      return config ? config.config_value : defaultValue;
    },
    [configs]
  );

  const [powerLimits, setPowerLimits] = useState(DEFAULT_POWER_LIMITS);

  const [aiSettings, setAiSettings] = useState(DEFAULT_AI_SETTINGS);

  React.useEffect(() => {
    const limits = getConfigValue('leadership_caps', DEFAULT_POWER_LIMITS);
    setPowerLimits(limits);

    const ai = getConfigValue('ai_ethics', DEFAULT_AI_SETTINGS);
    setAiSettings(ai);
  }, [getConfigValue]);

  if (!isAdmin) {
    return (
      <div className="p-6 rounded-2xl border border-slate-200 bg-white">
        <h2 className="text-xl font-black text-slate-900">Not authorized</h2>
        <p className="text-slate-600 font-semibold text-sm mt-2">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="w-8 h-8 text-slate-600" />
        <div>
          <h1 className="text-3xl font-black text-slate-900">Platform Configuration</h1>
          <p className="text-slate-600 font-semibold">Modular, safety-first settings</p>
        </div>
      </div>

      <Tabs defaultValue="power_limits" className="space-y-6">
        <TabsList className="bg-white border-3 border-slate-200 p-2 rounded-2xl">
          <TabsTrigger value="power_limits" className="rounded-xl font-bold data-[state=active]:bg-[#3A3DFF] data-[state=active]:text-white">
            <Shield className="w-4 h-4 mr-2" />
            Power Limits
          </TabsTrigger>
          <TabsTrigger value="ai_ethics" className="rounded-xl font-bold data-[state=active]:bg-purple-500 data-[state=active]:text-white">
            <Sparkles className="w-4 h-4 mr-2" />
            AI Ethics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="power_limits" className="space-y-4">
          <div className="bg-white rounded-3xl p-8 border-3 border-slate-200 shadow-lg">
            <h2 className="text-xl font-black text-slate-900 mb-4">Leadership Role Caps</h2>
            <p className="text-sm text-slate-600 mb-6">
              Prevents power concentration by limiting simultaneous leadership roles per user
            </p>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">Max Movements Created</label>
                <Input
                  type="number"
                  value={powerLimits.max_movements_created}
                  onChange={(e) => setPowerLimits({...powerLimits, max_movements_created: parseInt(e.target.value)})}
                  className="w-24 h-10 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">Max Collaborator Roles</label>
                <Input
                  type="number"
                  value={powerLimits.max_collaborator_roles}
                  onChange={(e) => setPowerLimits({...powerLimits, max_collaborator_roles: parseInt(e.target.value)})}
                  className="w-24 h-10 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">Max Events Organized</label>
                <Input
                  type="number"
                  value={powerLimits.max_events_organized}
                  onChange={(e) => setPowerLimits({...powerLimits, max_events_organized: parseInt(e.target.value)})}
                  className="w-24 h-10 rounded-xl"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-700">Max Petitions Created</label>
                <Input
                  type="number"
                  value={powerLimits.max_petitions_created}
                  onChange={(e) => setPowerLimits({...powerLimits, max_petitions_created: parseInt(e.target.value)})}
                  className="w-24 h-10 rounded-xl"
                />
              </div>
            </div>

            <Button
              onClick={() => updateConfigMutation.mutate({
                key: 'leadership_caps',
                value: powerLimits,
                category: 'power_limits',
                description: 'Maximum leadership roles per user'
              })}
              className="w-full mt-6 bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Power Limits
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="ai_ethics" className="space-y-4">
          <div className="bg-white rounded-3xl p-8 border-3 border-slate-200 shadow-lg">
            <h2 className="text-xl font-black text-slate-900 mb-4">AI Ethics Constraints</h2>
            <p className="text-sm text-slate-600 mb-6">
              Ensures AI features are transparent and non-prescriptive
            </p>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-bold text-slate-900 text-sm">Show &quot;AI-Generated&quot; Indicators</p>
                  <p className="text-xs text-slate-600">Display clear labels on all AI content</p>
                </div>
                <Switch
                  checked={aiSettings.show_ai_indicators}
                  onCheckedChange={(checked) => setAiSettings({...aiSettings, show_ai_indicators: checked})}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-bold text-slate-900 text-sm">Sanitize Prescriptive Language</p>
                  <p className="text-xs text-slate-600">Remove &quot;you must&quot; / &quot;you should&quot; statements</p>
                </div>
                <Switch
                  checked={aiSettings.sanitize_prescriptive_language}
                  onCheckedChange={(checked) => setAiSettings({...aiSettings, sanitize_prescriptive_language: checked})}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-bold text-slate-900 text-sm">Block Moral Judgments</p>
                  <p className="text-xs text-slate-600">Prevent AI from making ethical claims</p>
                </div>
                <Switch
                  checked={aiSettings.block_moral_judgments}
                  onCheckedChange={(checked) => setAiSettings({...aiSettings, block_moral_judgments: checked})}
                />
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-bold text-slate-900 text-sm">Show Uncertainty Warnings</p>
                  <p className="text-xs text-slate-600">Label predictions as estimates, not certainties</p>
                </div>
                <Switch
                  checked={aiSettings.show_uncertainty_warnings}
                  onCheckedChange={(checked) => setAiSettings({...aiSettings, show_uncertainty_warnings: checked})}
                />
              </div>
            </div>

            <Button
              onClick={() => updateConfigMutation.mutate({
                key: 'ai_ethics',
                value: aiSettings,
                category: 'ai_ethics',
                description: 'AI ethical constraints and transparency'
              })}
              className="w-full mt-6 bg-purple-600 hover:bg-purple-700 rounded-xl font-bold"
            >
              <Save className="w-4 h-4 mr-2" />
              Save AI Settings
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}