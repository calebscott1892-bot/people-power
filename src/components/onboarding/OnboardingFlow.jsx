import React, { useRef, useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowRight, ArrowLeft, Sparkles, Users, Zap, Target, CheckCircle, Shield, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { entities } from '@/api/appClient';
import { useAuth } from '@/auth/AuthProvider';
import { acceptPlatformAcknowledgment, fetchMyPlatformAcknowledgment } from '@/api/platformAckClient';

const interestOptions = [
  { id: 'environment', label: 'Environment', icon: '🌍', color: 'from-green-500 to-emerald-500' },
  { id: 'social_justice', label: 'Social Justice', icon: '✊', color: 'from-purple-500 to-pink-500' },
  { id: 'education', label: 'Education', icon: '📚', color: 'from-blue-500 to-cyan-500' },
  { id: 'health', label: 'Health & Wellness', icon: '💚', color: 'from-red-500 to-orange-500' },
  { id: 'community', label: 'Community', icon: '🤝', color: 'from-yellow-500 to-amber-500' },
  { id: 'arts', label: 'Arts & Culture', icon: '🎨', color: 'from-indigo-500 to-purple-500' },
  { id: 'technology', label: 'Technology', icon: '💻', color: 'from-cyan-500 to-blue-500' },
  { id: 'animals', label: 'Animal Rights', icon: '🐾', color: 'from-pink-500 to-rose-500' }
];

export default function OnboardingFlow({ user, onComplete }) {
  const { session } = useAuth();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const accessToken = session?.access_token ? String(session.access_token) : null;
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [safetyAckAccepted, setSafetyAckAccepted] = useState(false);
  const [platformAckAccepted, setPlatformAckAccepted] = useState(false);
  const [platformAckLoading, setPlatformAckLoading] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    try {
      const email = user?.email ? String(user.email).trim().toLowerCase() : '';
      const key = email ? `peoplepower_terms_accepted:${email}` : 'peoplepower_terms_accepted';
      const saved = localStorage.getItem(key) === 'true';
      if (saved) setLegalAccepted(true);
    } catch {
      // ignore
    }
  }, [user?.email]);

  useEffect(() => {
    try {
      const email = user?.email ? String(user.email).trim().toLowerCase() : '';
      const ageKey = email ? `peoplepower_age_confirmed:${email}` : 'peoplepower_age_confirmed';
      const safetyKey = email ? `peoplepower_safety_ack:${email}` : 'peoplepower_safety_ack';
      if (localStorage.getItem(ageKey) === 'true') setAgeConfirmed(true);
      if (localStorage.getItem(safetyKey) === 'true') setSafetyAckAccepted(true);
    } catch {
      // ignore
    }
  }, [user?.email]);

  useEffect(() => {
    let cancelled = false;
    async function loadPlatformAck() {
      const email = user?.email ? String(user.email) : null;
      if (!email) {
        setPlatformAckAccepted(false);
        return;
      }
      setPlatformAckLoading(true);
      try {
        const accessToken = session?.access_token ? String(session.access_token) : null;
        const res = await fetchMyPlatformAcknowledgment({ accessToken, userEmail: email });
        if (!cancelled) setPlatformAckAccepted(!!res?.accepted);
      } catch {
        if (!cancelled) setPlatformAckAccepted(false);
      } finally {
        if (!cancelled) setPlatformAckLoading(false);
      }
    }
    loadPlatformAck();
    return () => {
      cancelled = true;
    };
  }, [user?.email, session?.access_token]);

  // Prevent the blurred background page from scrolling while the onboarding modal is open.
  useEffect(() => {
    const scrollY = window.scrollY || 0;
    const prev = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      overflow: document.body.style.overflow,
    };

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.position = prev.position;
      document.body.style.top = prev.top;
      document.body.style.left = prev.left;
      document.body.style.right = prev.right;
      document.body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  const { data: onboarding } = useQuery({
    queryKey: ['onboarding', user?.email],
    queryFn: async () => {
      const records = await entities.UserOnboarding.filter({ user_email: user.email });
      if (records.length > 0) return records[0];
      
      // Create new onboarding record
      return entities.UserOnboarding.create({
        user_email: user.email,
        completed: false,
        current_step: 0,
        interests: [],
        completed_tutorials: []
      });
    },
    enabled: !!user
  });

  useEffect(() => {
    if (!onboarding) return;
    const persistedStep = typeof onboarding?.current_step === 'number' ? onboarding.current_step : 0;
    const nextStep = Math.max(0, Math.min(persistedStep, steps.length - 1));
    setCurrentStep(nextStep);
    setSelectedInterests(Array.isArray(onboarding?.interests) ? onboarding.interests : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding]);

  const updateOnboardingMutation = useMutation({
    mutationFn: async (updates) => {
      if (!onboarding) return;
      await entities.UserOnboarding.update(onboarding.id, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    }
  });

  const completeOnboarding = () => {
    if (user?.email) {
      queryClient.setQueryData(['onboarding', user.email], (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          completed: true,
          interests: selectedInterests,
          current_step: steps.length,
        };
      });
    }
    updateOnboardingMutation.mutate({
      completed: true,
      interests: selectedInterests,
      current_step: steps.length
    });
    onComplete();
  };

  const steps = [
    {
      id: 'welcome',
      title: t('onboarding.steps.welcome.title'),
      description: t('onboarding.steps.welcome.description'),
      component: <WelcomeStep />
    },
    {
      id: 'legal',
      title: t('onboarding.steps.legal.title'),
      description: t('onboarding.steps.legal.description'),
      component: (
        <LegalAcknowledgmentStep
          userEmail={user?.email ?? null}
          accessToken={accessToken}
          legalAccepted={legalAccepted}
          setLegalAccepted={setLegalAccepted}
          ageConfirmed={ageConfirmed}
          setAgeConfirmed={setAgeConfirmed}
          safetyAckAccepted={safetyAckAccepted}
          setSafetyAckAccepted={setSafetyAckAccepted}
          platformAckAccepted={platformAckAccepted}
          setPlatformAckAccepted={setPlatformAckAccepted}
          platformAckLoading={platformAckLoading}
        />
      )
    },
    {
      id: 'interests',
      title: t('onboarding.steps.interests.title'),
      description: t('onboarding.steps.interests.description'),
      component: <InterestsStep interests={selectedInterests} setInterests={setSelectedInterests} />
    },
    {
      id: 'movements',
      title: t('onboarding.steps.movements.title'),
      description: t('onboarding.steps.movements.description'),
      component: <MovementsGuide />
    },
    {
      id: 'create',
      title: t('onboarding.steps.create.title'),
      description: t('onboarding.steps.create.description'),
      component: <CreateGuide />
    },
    {
      id: 'collaborate',
      title: t('onboarding.steps.collaborate.title'),
      description: t('onboarding.steps.collaborate.description'),
      component: <CollaborateGuide />
    }
  ];

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      const next = currentStep + 1;
      setCurrentStep(next);
      updateOnboardingMutation.mutate({ current_step: next });
    } else {
      completeOnboarding();
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const stepKey = steps[currentStep]?.id || 'step';
  const titleId = `onboarding_title_${stepKey}`;
  const descId = `onboarding_desc_${stepKey}`;

  useEffect(() => {
    // Focus the first interactive element inside the dialog.
    const root = dialogRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables?.[0];
    if (first && typeof first.focus === 'function') {
      first.focus();
      return;
    }
    if (typeof root.focus === 'function') root.focus();
  }, [currentStep]);

  const handleKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (!root) return;

    const focusables = Array.from(
      root.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === root) {
        e.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <motion.div
      ref={overlayRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : undefined }}
      role="presentation"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        ref={dialogRef}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: reduceMotion ? 0 : undefined }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        tabIndex={-1}
        className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
      >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#3A3DFF] to-[#5B5EFF] p-6 text-white">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <span className="font-black text-sm uppercase tracking-wide">Step {currentStep + 1} of {steps.length}</span>
                </div>
                {/* Header skip (if present) */}
                <Button
                  variant="ghost"
                  onClick={completeOnboarding}
                  disabled={!legalAccepted || !platformAckAccepted || !ageConfirmed || !safetyAckAccepted}
                  className="text-white/90 font-bold hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('onboarding.nav.skip')}
                </Button>
              </div>
              
              {/* Progress Bar */}
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[#FFC947]"
                  initial={{ width: 0 }}
                  animate={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
                  transition={{ duration: reduceMotion ? 0 : 0.3 }}
                />
              </div>
            </div>

            {/* Content */}
            <div className="p-8 flex-1 overflow-y-auto overscroll-contain">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentStep}
                  initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 20 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -20 }}
                  transition={{ duration: reduceMotion ? 0 : 0.3 }}
                >
                  <h2 id={titleId} className="text-3xl font-black text-slate-900 mb-3">
                    {steps[currentStep].title}
                  </h2>
                  <p id={descId} className="text-slate-600 font-semibold mb-6">
                    {steps[currentStep].description}
                  </p>
                  
                  <div className="min-h-[300px]">
                    {steps[currentStep].component}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="border-t-2 border-slate-200 p-6 flex items-center justify-between bg-white">
              <Button
                onClick={prevStep}
                disabled={currentStep === 0}
                variant="outline"
                className="rounded-xl font-bold"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                {t('onboarding.nav.back')}
              </Button>
              
              <Button
                variant="ghost"
                onClick={completeOnboarding}
                disabled={!legalAccepted || !platformAckAccepted || !ageConfirmed || !safetyAckAccepted}
                className="font-bold text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('onboarding.nav.skip_tour')}
              </Button>

              <Button
                onClick={nextStep}
                disabled={
                  (currentStep === 1 && (!legalAccepted || !platformAckAccepted || !ageConfirmed || !safetyAckAccepted)) ||
                  (currentStep === 2 && selectedInterests.length === 0)
                }
                className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] hover:from-[#FFD666] hover:to-[#FFC947] text-slate-900 rounded-xl font-bold"
              >
                {currentStep === steps.length - 1 ? (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    {t('onboarding.nav.get_started')}
                  </>
                ) : (
                  <>
                    {t('onboarding.nav.next')}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
      </motion.div>
    </motion.div>
  );
}

function WelcomeStep() {
  const reduceMotion = useReducedMotion();
  return (
    <div className="flex flex-col items-center justify-center text-center py-8">
      <motion.div
        animate={reduceMotion ? { rotate: 0, scale: 1 } : { rotate: [0, 5, -5, 0], scale: [1, 1.1, 1] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 2, repeat: Infinity }}
        className="w-24 h-24 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-3xl flex items-center justify-center mb-6 shadow-xl"
      >
        <Zap className="w-12 h-12 text-[#FFC947]" fill="#FFC947" strokeWidth={3} />
      </motion.div>
      <h3 className="text-2xl font-black text-slate-900 mb-3">
        Transform Ideas Into Action
      </h3>
      <p className="text-slate-600 max-w-md leading-relaxed">
        Create movements, collaborate with others, and make real impact. 
        This quick tour will show you how.
      </p>
    </div>
  );
}

function InterestsStep({ interests, setInterests }) {
  const reduceMotion = useReducedMotion();
  const toggleInterest = (id) => {
    setInterests(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div>
      <p className="text-sm text-slate-500 font-semibold mb-4">Select at least one (you can change this later)</p>
      <div className="grid grid-cols-2 gap-3">
        {interestOptions.map((option) => (
          <motion.button
            key={option.id}
            onClick={() => toggleInterest(option.id)}
            whileHover={reduceMotion ? undefined : { scale: 1.02 }}
            whileTap={reduceMotion ? undefined : { scale: 0.98 }}
            aria-pressed={interests.includes(option.id)}
            className={cn(
              "p-4 rounded-xl border-2 transition-all text-left",
              interests.includes(option.id)
                ? "border-[#3A3DFF] bg-indigo-50"
                : "border-slate-200 hover:border-slate-300"
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center text-2xl bg-gradient-to-br",
                option.color
              )}>
                {option.icon}
              </div>
              <span className="font-bold text-slate-900 text-sm">{option.label}</span>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function MovementsGuide() {
  return (
    <div className="space-y-6">
      <GuideItem
        icon={<Target className="w-5 h-5" />}
        title="Discover Movements"
        description="Browse movements by momentum, impact, or location. Use AI search to find exactly what you care about."
        color="bg-blue-500"
      />
      <GuideItem
        icon={<Zap className="w-5 h-5" />}
        title="Boost & Support"
        description="Show support by boosting movements. Your engagement increases their momentum and visibility."
        color="bg-yellow-500"
      />
      <GuideItem
        icon={<Users className="w-5 h-5" />}
        title="Follow Updates"
        description="Follow movements to get notified about progress, events, and calls to action."
        color="bg-purple-500"
      />
    </div>
  );
}

function CreateGuide() {
  return (
    <div className="space-y-6">
      <GuideItem
        icon={<Sparkles className="w-5 h-5" />}
        title="AI-Powered Creation"
        description="Use our AI assistant to generate ideas, draft descriptions, and get strategy suggestions."
        color="bg-indigo-500"
      />
      <GuideItem
        icon={<Target className="w-5 h-5" />}
        title="Build Your Movement"
        description="Add details, tags, location, and media to make your movement stand out and attract supporters."
        color="bg-green-500"
      />
    </div>
  );
}

function CollaborateGuide() {
  return (
    <div className="space-y-6">
      <GuideItem
        icon={<Users className="w-5 h-5" />}
        title="Invite Team Members"
        description="Add collaborators with different roles: admins, editors, or viewers to manage your movement."
        color="bg-purple-500"
      />
      <GuideItem
        icon={<CheckCircle className="w-5 h-5" />}
        title="Manage Tasks"
        description="Create and assign tasks to coordinate action. Track progress as your team works together."
        color="bg-green-500"
      />
    </div>
  );
}

function LegalAcknowledgmentStep({
  userEmail,
  accessToken,
  legalAccepted,
  setLegalAccepted,
  ageConfirmed,
  setAgeConfirmed,
  safetyAckAccepted,
  setSafetyAckAccepted,
  platformAckAccepted,
  setPlatformAckAccepted,
  platformAckLoading,
}) {
  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="text-blue-900 font-bold">We&apos;re a tool, not an organizer:</p>
            <p className="text-blue-800">People Power provides technology for community organizing. We don&apos;t endorse, verify, or take responsibility for movements created by users.</p>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="space-y-2 text-sm">
            <p className="text-amber-900 font-bold">You&apos;re responsible for your actions:</p>
            <p className="text-amber-800">Both online and offline, you&apos;re responsible for your participation. Always verify information, follow local laws, and prioritize safety.</p>
          </div>
        </div>
      </div>

      <div className="bg-slate-50 border-2 border-slate-200 rounded-xl p-4">
        <div className="space-y-2 text-sm text-slate-700">
          <p className="font-bold">✓ We keep minimal data (location is optional)</p>
          <p className="font-bold">✓ We cooperate with lawful requests only</p>
          <p className="font-bold">✓ These terms apply worldwide</p>
        </div>
      </div>

      <div className="pt-2 space-y-3">
        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={ageConfirmed}
            onChange={(e) => {
              const next = !!e.target.checked;
              setAgeConfirmed(next);
              try {
                const email = userEmail ? String(userEmail).trim().toLowerCase() : '';
                const key = email ? `peoplepower_age_confirmed:${email}` : 'peoplepower_age_confirmed';
                localStorage.setItem(key, next ? 'true' : 'false');
              } catch {
                // ignore
              }
            }}
          />
          <span className="font-semibold">
            I confirm I meet the minimum age requirement to use this platform (at least 13 years old, or the age required in my jurisdiction).
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={safetyAckAccepted}
            onChange={(e) => {
              const next = !!e.target.checked;
              setSafetyAckAccepted(next);
              try {
                const email = userEmail ? String(userEmail).trim().toLowerCase() : '';
                const key = email ? `peoplepower_safety_ack:${email}` : 'peoplepower_safety_ack';
                localStorage.setItem(key, next ? 'true' : 'false');
              } catch {
                // ignore
              }
            }}
          />
          <span className="font-semibold">
            I understand this platform is not an emergency service. If I or someone else is in immediate danger, I will contact local emergency services.
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={platformAckAccepted}
            disabled={platformAckLoading || !userEmail}
            onChange={async (e) => {
              const next = e.target.checked;
              setPlatformAckAccepted(next);
              if (next && userEmail) {
                try {
                  await acceptPlatformAcknowledgment({ accessToken, userEmail });
                } catch (err) {
                  setPlatformAckAccepted(false);
                  toast.error(err?.message || 'Failed to record acknowledgment');
                }
              }
            }}
          />
          <span className="font-semibold">
            I acknowledge that People Power is a neutral facilitation platform and does not organise, endorse, or verify movements or events.
          </span>
        </label>

        {!userEmail ? (
          <div className="text-xs text-slate-600 font-semibold">
            Log in to record this acknowledgment.
          </div>
        ) : null}

        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300"
            checked={legalAccepted}
            onChange={(e) => {
              const next = e.target.checked;
              setLegalAccepted(next);
              try {
                const email = userEmail ? String(userEmail).trim().toLowerCase() : '';
                const key = email ? `peoplepower_terms_accepted:${email}` : 'peoplepower_terms_accepted';
                localStorage.setItem(key, next ? 'true' : 'false');
              } catch {
                // ignore
              }
            }}
          />
          <span className="font-semibold">
            I have read and accept the Terms of Service and understand my responsibilities.
          </span>
        </label>
        <Link 
          to={createPageUrl('TermsOfService')} 
          target="_blank"
          className="text-[#3A3DFF] hover:underline text-sm font-bold inline-flex items-center gap-1"
        >
          Read Full Terms of Service →
        </Link>
      </div>
    </div>
  );
}

function GuideItem({ icon, title, description, color }) {
  return (
    <div className="flex gap-4">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white", color)}>
        {icon}
      </div>
      <div>
        <h4 className="font-black text-slate-900 mb-1">{title}</h4>
        <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}