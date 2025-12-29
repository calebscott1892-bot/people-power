import React from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function TermsOfService() {
  const checklist = [
    'We provide tools, not legal advice or organizational services',
    "You're responsible for your actions, both online and offline",
    "We don't endorse movements — they're created by community members",
    'We keep minimal data and respect your privacy',
    'We cooperate with lawful government requests only',
    'These terms apply regardless of where you are in the world',
  ];

  const sections = [
    {
      title: '1. Acceptance of Terms',
      body:
        'By accessing or using People Power, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any part of these terms, you may not use our service.',
    },
    {
      title: '2. User Responsibility',
      intro: 'You are solely responsible for:',
      list: [
        'All content you post, create, or share on the platform',
        'All actions you take based on information found on People Power',
        'Your participation in any movements, events, or activities',
        'Ensuring your actions comply with all applicable laws',
        'The accuracy and legality of information you provide',
      ],
    },
    {
      title: '3. Platform Disclaimers & Non-Endorsement',
      intro: 'People Power does NOT:',
      list: [
        'Endorse, verify, or take responsibility for any movement, event, or user-generated content',
        'Guarantee the accuracy, safety, or legality of any information posted by users',
        'Verify participant counts, evidence submissions, or user claims',
        'Control or supervise offline activities organized through the platform',
        'Act as an organizer, coordinator, or sponsor of any movement or event',
      ],
      note:
        'Platform Neutrality Statement: People Power is a neutral technology platform. We provide tools for community organizing but do not endorse, approve, or take positions on any movements, causes, or political viewpoints expressed by users. All movements reflect the views of their creators, not the platform.',
    },
    {
      title: '4. Services Provided "As-Is"',
      body:
        'All services are provided "as-is" without warranties of any kind, either express or implied. We do not warrant that the service will be uninterrupted, secure, or error-free. You use People Power at your own risk.',
    },
    {
      title: '5. Platform Rights & Moderation',
      intro: 'People Power reserves the right to:',
      list: [
        'Remove, modify, or restrict access to any content that violates our policies',
        'Suspend or terminate user accounts for violations',
        'Moderate content to maintain safety and comply with laws',
        'Modify or discontinue features at any time without notice',
        'Refuse service to anyone for any reason',
      ],
    },
    {
      title: '6. Limitation of Liability & Real-World Outcomes',
      intro: 'People Power is NOT liable for:',
      list: [
        'Any offline actions, events, or consequences resulting from platform use',
        'Real-world outcomes, impacts, or results of movements organized through the platform',
        'Inaccuracies, errors, or omissions in user-generated content',
        'Damages, injuries, losses, or legal consequences stemming from participation in movements or events',
        'User disputes, conflicts, or interactions',
        'Third-party conduct, content, or external links',
        'Data loss, security breaches, or system failures',
        'Any claims arising from actions taken based on information found on the platform',
      ],
      note:
        'Critical Note: You assume all risks and responsibilities for participating in offline activities, attending events, or taking action based on content found on this platform. Always verify information independently, ensure activities comply with local laws, and prioritize your safety.',
    },
    {
      title: '7. Indemnification',
      body:
        'You agree to indemnify and hold harmless People Power, its operators, and affiliates from any claims, damages, losses, or expenses arising from your use of the platform, your content, or your violation of these terms.',
    },
    {
      title: '8. Points System Disclaimer',
      body:
        'Points earned through Daily Challenges are non-financial, have no monetary value, and cannot be redeemed for real goods or services. Points are for engagement purposes only and may be modified or removed at any time.',
    },
    {
      title: '9. Jurisdiction & Governing Law',
      body:
        'These terms are designed to be jurisdiction-agnostic and apply to users worldwide. However, you are responsible for ensuring your use of the platform complies with all applicable local, state, national, and international laws in your jurisdiction. In the event of legal disputes, the laws of the platform operator’s registered jurisdiction will apply to the extent permitted by applicable law, without regard to conflict of law principles.',
    },
    {
      title: '10. Law Enforcement & Legal Cooperation',
      intro: 'Emergency Cooperation:',
      list: [
        'Required by valid legal process (subpoena, warrant, court order)',
        'Necessary to protect safety, prevent harm, or address emergencies',
        'Mandated to comply with applicable laws and regulations',
      ],
      note:
        'We will only disclose user information to the minimum extent required by law and will notify users unless legally prohibited from doing so.',
    },
    {
      title: '11. Data Minimization & Privacy',
      intro: 'Data Minimization Principles:',
      list: [
        'Location Data: Location information is optional and stored only when you explicitly provide it. You can remove or update location data at any time from your profile settings.',
        'Data Collection: We collect only the minimum data necessary to provide platform functionality.',
        'User Control: You have the right to access, modify, or delete your personal information.',
        'No Sale of Data: We never sell user data to third parties.',
        'Retention: Data is retained only as long as necessary for platform operation or as required by law.',
      ],
    },
    {
      title: '12. Changes to Terms',
      body:
        'We reserve the right to modify these Terms of Service at any time. Continued use of the platform after changes constitutes acceptance of the updated terms. Material changes will be communicated via the platform.',
    },
    {
      title: '13. Contact',
      body:
        'For questions about these Terms of Service, please contact us through the platform’s support channels.',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-indigo-600 to-blue-500 text-white px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Terms of Service</p>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight">TERMS OF SERVICE</h1>
                <p className="text-sm sm:text-base font-semibold mt-1">Last Updated: December 2024</p>
              </div>
            </div>
            <Link
              to="/legal-hub"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white border border-white/70 px-3 py-2 rounded-full hover:bg-white/10"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </div>
          <div className="mt-6 grid gap-2 text-sm sm:text-base">
            {checklist.map((item) => (
              <div key={item} className="flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-amber-200 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm sm:text-base font-semibold">
            IMPORTANT NOTICE: By using People Power, you agree to these Terms of Service. Please read them carefully. You are solely responsible for your actions and content posted on this platform.
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
        </div>
      </motion.div>
    </div>
  );
}