import React from 'react';
import { motion } from 'framer-motion';
import { HeartHandshake, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import BackButton from '@/components/shared/BackButton';

export default function CommunityGuidelines() {
  const sections = [
    {
      title: '1. Be Respectful',
      items: [
        "Treat everyone with dignity and kindness, even when you disagree. We're all here to make the world better.",
        'Listen to different perspectives with an open mind',
        'Avoid personal attacks, insults, or hostile language',
        "Respect people's identities, backgrounds, and experiences",
        'Critique ideas, not individuals',
      ],
    },
    {
      title: '2. Collaborate & Support',
      items: [
        "People Power is strongest when we work together. Support each other's movements and efforts.",
        'Offer constructive feedback, not destructive criticism',
        "Celebrate others' successes",
        'Share resources and knowledge generously',
        'Help newcomers feel welcome',
      ],
    },
    {
      title: '3. Prioritize Safety',
      items: [
        'Your safety and the safety of others always comes first.',
        "Never share other people's private information",
        "Don't encourage dangerous activities or stunts",
        'Verify event safety before attending',
        'Report threats, harassment, or harmful content immediately',
        'Act legally and peacefully at all times',
      ],
    },
    {
      title: '4. Be Responsible & Truthful',
      items: [
        'Honesty and accountability keep our community trustworthy.',
        "Post accurate information — don't spread misinformation",
        'Take responsibility for your content and actions',
        "Don't impersonate others or create fake accounts",
        'If you make a mistake, own it and correct it',
        'Be transparent about your intentions and affiliations',
      ],
    },
    {
      title: '5. Keep It Positive & Constructive',
      items: [
        'People Power is a space for solutions, not just problems.',
        "Focus on what can be done, not just what's wrong",
        'Inspire action through hope, not fear',
        'Encourage participation and empowerment',
        'Avoid negativity spirals and doom-posting',
      ],
    },
    {
      title: '6. No Harmful Stunts or Misinformation',
      items: [
        '⚠️ Do NOT post challenges or content that:',
        'Could cause physical harm or injury',
        'Spreads false medical or health information',
        'Promotes dangerous behaviors',
        'Deliberately misleads or deceives others',
      ],
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] text-slate-900 px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <HeartHandshake className="w-8 h-8 sm:w-10 sm:h-10" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Community Guidelines</p>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight">COMMUNITY GUIDELINES</h1>
                <p className="text-sm sm:text-base font-semibold mt-1">Building a Respectful, Safe, and Powerful Community</p>
              </div>
            </div>
            <BackButton
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 border border-slate-900/20 bg-white/40 hover:bg-white/60 px-3 py-2 rounded-full"
              iconClassName="w-4 h-4"
            />
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-6 text-slate-800 text-sm sm:text-base leading-6">
          <p>
            People Power exists to unite people around shared goals and create positive change. These guidelines help us maintain a space where everyone feels safe, respected, and empowered.
          </p>

          {sections.map((section) => (
            <section key={section.title} className="space-y-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">{section.title}</h2>
              <ul className="list-disc pl-5 space-y-1">
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}

          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Reporting & Enforcement</h2>
            <p>If you see content that violates these guidelines, please report it. Every report is reviewed.</p>
            <p className="font-semibold">
              <Link className="text-[#3A3DFF] hover:underline" to="/legal-hub#reporting">
                Learn how reporting works
              </Link>
            </p>
            <h3 className="font-bold">What Happens Next</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Our team reviews reports and takes appropriate action, which may include content removal or account suspension.</li>
            </ul>
            <div className="flex items-start gap-2 text-emerald-700 font-semibold">
              <Sparkles className="w-5 h-5 mt-0.5" />
              <span>
                Together, We&apos;re Stronger — These guidelines exist to protect and empower our community. By following them, you help create a space where everyone can contribute to positive change.
              </span>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}
