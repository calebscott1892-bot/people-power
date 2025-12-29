import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import LocationPicker from './LocationPicker';
import { Loader2, Upload, X, Plus } from 'lucide-react';
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { entities, integrations } from '@/api/appClient';
import ExpressionRewardsPanel from '@/components/challenges/ExpressionRewardsPanel';
import { unlockExpressionReward } from '@/api/userChallengeStatsClient';
import { readPrivateUserCoordinates, writePrivateUserCoordinates, sanitizePublicLocation } from '@/utils/locationPrivacy';
import { exportMyData } from '@/api/userExportClient';
import { useAuth } from '@/auth/AuthProvider';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const suggestedSkills = [
  'Social Media Marketing', 'Event Planning', 'Legal Advocacy', 'Community Organizing',
  'Fundraising', 'Public Speaking', 'Graphic Design', 'Video Production',
  'Writing & Blogging', 'Research & Analysis', 'Policy Development', 'Grant Writing',
  'Volunteer Coordination', 'Crisis Management', 'Media Relations', 'Coalition Building'
];

export default function EditProfileModal({ open, onClose, profile, userEmail, userStats }) {
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [skills, setSkills] = useState(profile?.skills || []);
  const [skillInput, setSkillInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(profile?.profile_photo_url || '');
  const [bannerUrl, setBannerUrl] = useState(profile?.banner_url || '');
  const MAX_UPLOAD_MB = 5;
  const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif'];
  const [aiEnabled, setAiEnabled] = useState(() => {
    if (profile && typeof profile === 'object' && 'ai_features_enabled' in profile) {
      return !!profile.ai_features_enabled;
    }
    try {
      return localStorage.getItem('peoplepower_ai_opt_in') === 'true';
    } catch {
      return false;
    }
  });
  const [location, setLocation] = useState(() => sanitizePublicLocation(profile?.location) || null);
  const [privateCoords, setPrivateCoords] = useState(() => readPrivateUserCoordinates(userEmail));
  const [catchmentRadius, setCatchmentRadius] = useState(profile?.catchment_radius_km || 50);
  const [exporting, setExporting] = useState(false);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (!open) return;

    // If older profiles stored coordinates, migrate them to private on-device storage.
    const legacy = profile?.location?.coordinates;
    const legacyLat = legacy && typeof legacy.lat === 'number' ? legacy.lat : null;
    const legacyLng = legacy && typeof legacy.lng === 'number' ? legacy.lng : null;
    if (legacyLat != null && legacyLng != null && userEmail) {
      writePrivateUserCoordinates(userEmail, { lat: legacyLat, lng: legacyLng });
      setPrivateCoords({ lat: legacyLat, lng: legacyLng });
    }

    setLocation(sanitizePublicLocation(profile?.location) || null);
    setPrivateCoords(readPrivateUserCoordinates(userEmail) || (legacyLat != null && legacyLng != null ? { lat: legacyLat, lng: legacyLng } : null));
  }, [open, profile, userEmail]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data) => {
      if (profile) {
        await entities.UserProfile.update(profile.id, data);
      } else {
        await entities.UserProfile.create({
          user_email: userEmail,
          ...data
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
      try {
        localStorage.setItem('peoplepower_ai_opt_in', aiEnabled ? 'true' : 'false');
      } catch {
        // ignore
      }
      toast.success('Profile updated!');
      onClose();
    }
  });

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
      return;
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF).');
      return;
    }

    setUploading(true);
    try {
      const { file_url } = await integrations.Core.UploadFile({ file });
      setPhotoUrl(file_url);
    } catch {
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const handleBannerUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`File too large. Max size is ${MAX_UPLOAD_MB}MB.`);
      return;
    }
    if (file.type && !ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error('That file type isn’t supported. Please upload an image (JPG/PNG/GIF).');
      return;
    }

    setUploadingBanner(true);
    try {
      const { file_url } = await integrations.Core.UploadFile({ file });
      setBannerUrl(file_url);
    } catch {
      toast.error('Failed to upload banner');
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!displayName.trim()) {
      toast.error('Display name is required');
      return;
    }

    if (userEmail && privateCoords?.lat != null && privateCoords?.lng != null) {
      writePrivateUserCoordinates(userEmail, privateCoords);
    }

    updateProfileMutation.mutate({
      display_name: displayName.trim(),
      username: username.trim() || displayName.trim().toLowerCase().replace(/\s+/g, ''),
      bio: bio.trim(),
      profile_photo_url: photoUrl,
      banner_url: bannerUrl,
      skills,
      ai_features_enabled: aiEnabled,
      location: sanitizePublicLocation(location),
      catchment_radius_km: catchmentRadius
    });
  };

  const handleDownloadMyData = async () => {
    const accessToken = session?.access_token ? String(session.access_token) : null;
    if (!accessToken) {
      toast.error('Please log in to export your data');
      return;
    }

    setExporting(true);
    try {
      const payload = await exportMyData({ accessToken });
      const pretty = JSON.stringify(payload ?? {}, null, 2);
      const blob = new Blob([pretty], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const date = new Date();
      const yyyy = String(date.getFullYear());
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const filename = `peoplepower-data-export-${yyyy}-${mm}-${dd}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success('Export downloaded');
    } catch (e) {
      toast.error(String(e?.message || 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Edit Profile</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {/* Banner */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Profile Banner</label>
            <div className="relative h-24 rounded-xl overflow-hidden">
              {bannerUrl ? (
                <img src={bannerUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-r from-[#3A3DFF] via-[#5B5EFF] to-[#3A3DFF]" />
              )}
              <label className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/50 transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleBannerUpload}
                  className="hidden"
                />
                <div className="text-white text-sm font-bold flex items-center gap-2">
                  {uploadingBanner ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Change Banner
                    </>
                  )}
                </div>
              </label>
            </div>
          </div>

          {/* Profile Photo */}
          <div className="flex flex-col items-center gap-3">
            {photoUrl ? (
              <img src={photoUrl} alt="" className="w-32 h-32 rounded-2xl object-cover" />
            ) : (
              <div className="w-32 h-32 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center">
                <span className="text-white font-black text-4xl">
                  {displayName[0]?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <label className="cursor-pointer">
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <Button type="button" variant="outline" className="font-bold rounded-xl" disabled={uploading}>
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-2" />
                )}
                Change Photo
              </Button>
            </label>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Display Name *</label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="rounded-xl border-2"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Username</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">@</span>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder="username"
                className="pl-8 rounded-xl border-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Bio</label>
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself..."
              className="rounded-xl border-2 min-h-[100px]"
              maxLength={200}
            />
            <p className="text-xs text-slate-400 mt-1">{bio.length}/200</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              Skills & Expertise <span className="text-slate-400 font-normal">(up to 8)</span>
            </label>
            
            {/* Selected Skills */}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 p-3 bg-slate-50 rounded-xl border-2 border-slate-200">
                {skills.map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#3A3DFF] text-white rounded-lg text-sm font-bold"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => setSkills(skills.filter((_, idx) => idx !== i))}
                      className="hover:bg-white/20 rounded-full p-0.5"
                      aria-label={`Remove skill ${skill}`}
                      title="Remove skill"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add Custom Skill */}
            {skills.length < 8 && (
              <div className="flex gap-2 mb-3">
                <Input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (skillInput.trim() && !skills.includes(skillInput.trim()) && skills.length < 8) {
                        setSkills([...skills, skillInput.trim()]);
                        setSkillInput('');
                      }
                    }
                  }}
                  placeholder="Add custom skill..."
                  className="flex-1 rounded-xl border-2"
                />
                <Button
                  type="button"
                  onClick={() => {
                    if (skillInput.trim() && !skills.includes(skillInput.trim()) && skills.length < 8) {
                      setSkills([...skills, skillInput.trim()]);
                      setSkillInput('');
                    }
                  }}
                  variant="outline"
                  className="rounded-xl font-bold"
                  aria-label="Add skill"
                  title="Add skill"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Suggested Skills */}
            <div className="flex flex-wrap gap-2">
              {suggestedSkills
                .filter(s => !skills.includes(s))
                .slice(0, 6)
                .map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => {
                      if (skills.length < 8) setSkills([...skills, skill]);
                    }}
                    disabled={skills.length >= 8}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 border-slate-300 text-slate-700 hover:border-[#3A3DFF] hover:text-[#3A3DFF] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    + {skill}
                  </button>
                ))}
            </div>
          </div>

          {/* AI Features Toggle */}
          <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border-2 border-indigo-200">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <label className="block text-sm font-black text-slate-900 mb-1">
                  AI-Powered Features
                </label>
                <p className="text-xs text-slate-600">
                  Enable AI assistance for movement creation, analytics, and personalized recommendations
                </p>
              </div>
              <Switch
                checked={aiEnabled}
                onCheckedChange={setAiEnabled}
                className="ml-4"
              />
            </div>
          </div>

          {/* Expression Rewards */}
          {userStats && typeof userStats === 'object' ? (
            <div className="pt-2">
              <ExpressionRewardsPanel
                userStats={userStats}
                onUnlock={async (reward) => {
                  if (!userEmail) throw new Error('Missing user');
                  await unlockExpressionReward(userEmail, reward);
                  await queryClient.invalidateQueries({ queryKey: ['userChallengeStats'] });
                }}
              />
            </div>
          ) : null}

          {/* Location Settings */}
          <div>
            <h4 className="font-black text-slate-900 mb-3 text-lg">Location Settings</h4>
            <p className="text-sm text-slate-600 font-semibold mb-3">
              Local results are approximate. Your radius controls how far “Local” reaches.
            </p>
            <LocationPicker
              location={location}
              coordinates={privateCoords}
              radius={catchmentRadius}
              onLocationChange={setLocation}
              onCoordinatesChange={setPrivateCoords}
              onRadiusChange={setCatchmentRadius}
            />
          </div>

          {/* Data Export */}
          <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50">
            <div className="text-sm font-black text-slate-900">Download your data (JSON)</div>
            <p className="mt-1 text-xs text-slate-600 font-semibold">
              This export includes only your contributions and activity — not other users’ data.
            </p>
            <div className="mt-3">
              <Button
                type="button"
                onClick={handleDownloadMyData}
                disabled={exporting}
                variant="outline"
                className="font-bold rounded-xl border-2"
              >
                {exporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Preparing export…
                  </>
                ) : (
                  'Download your data (JSON)'
                )}
              </Button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              onClick={onClose}
              variant="outline"
              className="flex-1 font-bold rounded-xl border-2"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateProfileMutation.isPending}
              className="flex-1 bg-[#3A3DFF] hover:bg-[#2A2DDD] font-bold rounded-xl"
            >
              {updateProfileMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
