import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import BackButton from '@/components/shared/BackButton';

// NOTE: Static, dependency-free page so it can never crash the app at import time.
export default function PrivacyPolicy() {
  const sections = [
    {
      title: '1. Platform Role & Neutrality',
      body:
        'People Power is a neutral facilitation platform. We do not organize, endorse, or verify movements or events. Evidence, messages, and movement data are user-submitted and not verified by the platform.',
    },
    {
      title: '2. What We Collect',
      intro: 'We collect only what is needed to operate the service safely:',
      list: [
        'Account data (email, auth identifiers)',
        'Profile data (display name, username, optional bio)',
        'Content you create (movements, messages, reports)',
        'Safety signals (reports, moderation actions, audit logs)',
        'Basic technical data (IP address, device type, browser version)',
      ],
    },
    {
      title: '3. Location & Local Features',
      body:
        'Location is optional. If you set a local area, we store city-level or approximate information to show nearby movements. We avoid storing exact addresses and do not require precise GPS for general use.',
    },
    {
      title: '4. Legal Basis & Consent',
      body:
        'We process data to provide the service you request, keep the platform safe, and comply with legal obligations. Where required, we rely on your consent for optional features such as AI or local discovery settings.',
    },
    {
      title: '5. How We Use Information',
      intro: 'We use information to:',
      list: [
        'Run the platform and deliver requested features',
        'Support safety, moderation, and abuse prevention',
        'Improve the service and reliability',
        'Provide aggregate insights that do not identify individuals',
      ],
      note:
        'We do not sell personal data. Aggregated or anonymized data may be used for analytics and impact reporting.',
    },
    {
      title: '6. Data Sharing',
      body:
        'We share data only with trusted service providers that help us run the platform or when required by law. We do not share private content publicly without your action or consent.',
    },
    {
      title: '7. Security Practices',
      body:
        'We use reasonable technical and organizational measures to protect data. No system is perfectly secure, so please avoid sharing sensitive personal information.',
    },
    {
      title: '8. Data Retention',
      body:
        'We retain data only as long as needed to provide the service, comply with legal obligations, and keep the platform safe. You can request deletion where applicable.',
    },
    {
      title: '9. Your Rights & Controls',
      body:
        'You can update your profile, adjust your local area, and delete content you control. For account deletion requests or access inquiries, contact support through the app.',
    },
    {
      title: '10. Safety, Moderation & Legal Requests',
      body:
        'We may review content or activity for safety risks or policy violations. We respond to lawful requests where required. Nothing on this platform should be taken as legal or professional advice.',
    },
    {
      title: '11. Changes to This Policy',
      body:
        'We may update this Privacy Policy from time to time. Material changes will be communicated via the platform.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Privacy Policy</p>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight">PRIVACY POLICY</h1>
                <p className="text-sm sm:text-base font-semibold mt-1">Last Updated: December 2024</p>
              </div>
            </div>
            <BackButton
              className="inline-flex items-center gap-2 text-sm font-semibold text-white border border-white/70 px-3 py-2 rounded-full hover:bg-white/10"
              iconClassName="w-4 h-4"
            />
          </div>
          <p className="mt-6 text-sm sm:text-base font-semibold">
            This is an early-access service. Please avoid posting sensitive personal information while features are still evolving.
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-6 text-slate-800 text-sm sm:text-base leading-6">
          {sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">{section.title}</h2>
              {section.body && <p>{section.body}</p>}
              {section.intro && <p>{section.intro}</p>}
              {section.list && (
                <ul className="list-disc pl-5 space-y-1">
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.note && <p className="font-semibold text-slate-800">{section.note}</p>}
            </section>
          ))}
          <p className="text-xs text-slate-500">
            This summary is for product clarity and does not replace legally binding terms that may apply to your use of People Power.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
