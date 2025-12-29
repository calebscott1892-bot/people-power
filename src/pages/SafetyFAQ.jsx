import React from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, ArrowLeft, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SafetyFAQ() {
  const sections = [
    {
      title: 'How does reporting work?',
      body: (
        <>
          <p>
            You can report a movement, comment, message, or profile using the <strong>Report</strong> button on that item.
            Reports are private—your identity is not shown to the person you reported.
          </p>
          <p className="font-semibold">
            You can also review our policies in the <Link className="text-[#3A3DFF] hover:underline" to="/legal-hub">Legal &amp; Safety Hub</Link>.
          </p>
        </>
      ),
    },
    {
      title: 'What happens after I report something?',
      body: (
        <>
          <p>
            Reports help us prioritize review. A report may lead to a human review of the content and surrounding context.
            Not every report results in action, but every report is taken seriously.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>We review the report and any relevant context.</li>
            <li>We compare what we see against our policies.</li>
            <li>We take the least-invasive action needed to reduce harm.</li>
          </ul>
        </>
      ),
    },
    {
      title: 'What kinds of content or behavior are not allowed?',
      body: (
        <>
          <p>
            People Power is for peaceful, lawful organizing and constructive civic action. We prohibit content and behavior that creates harm—
            including threats, harassment, hate, doxxing/privacy violations, scams, and illegal coordination.
          </p>
          <p className="font-semibold">
            See: <Link className="text-[#3A3DFF] hover:underline" to="/content-policy">Content Policy</Link> and{' '}
            <Link className="text-[#3A3DFF] hover:underline" to="/community-guidelines">Community Guidelines</Link>.
          </p>
        </>
      ),
    },
    {
      title: 'What actions can People Power take?',
      body: (
        <>
          <p>
            Depending on severity and history, we may take actions such as:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Remove or restrict access to content that violates policy</li>
            <li>Issue a warning and explain what needs to change</li>
            <li>Temporarily suspend an account for repeated or serious violations</li>
            <li>Permanently ban accounts for severe harm or repeated evasion</li>
          </ul>
          <p className="font-semibold">
            For the full platform rights and disclaimers, see <Link className="text-[#3A3DFF] hover:underline" to="/terms-of-service">Terms of Service</Link>.
          </p>
        </>
      ),
    },
    {
      title: 'How do appeals work?',
      body: (
        <>
          <p>
            If we take action on your account or content, you may be able to appeal. Appeals are reviewed with fresh context when possible.
            If we got it wrong, we will adjust or reverse the action.
          </p>
          <p className="text-slate-700 font-semibold">
            Tip: Include context, links, and anything that helps us understand what happened.
          </p>
        </>
      ),
    },
    {
      title: 'What if I’m in immediate danger?',
      body: (
        <>
          <p>
            If you’re in immediate danger, contact your local emergency services.
            People Power is not an emergency-response service.
          </p>
        </>
      ),
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
              <div className="relative">
                <HelpCircle className="w-8 h-8 sm:w-10 sm:h-10" />
                <Shield className="w-4 h-4 absolute -bottom-1 -right-1" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Safety &amp; Moderation</p>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight">SAFETY &amp; MODERATION FAQ</h1>
                <p className="text-sm sm:text-base font-semibold mt-1 text-slate-800">
                  Plain-language overview of reporting, review, and appeals.
                </p>
              </div>
            </div>
            <Link
              to="/legal-hub"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 border border-slate-900/20 bg-white/40 hover:bg-white/60 px-3 py-2 rounded-full"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-6 text-slate-800 text-sm sm:text-base leading-6">
          <p>
            People Power is built for civic participation and community organizing. These FAQs explain how safety and moderation work in practice.
            This page is informational and non-legal; the policies linked below are the source of truth.
          </p>

          <div className="space-y-3">
            <p className="font-semibold">Policies</p>
            <ul className="list-disc pl-5 space-y-1 font-semibold text-slate-700">
              <li><Link className="text-[#3A3DFF] hover:underline" to="/terms-of-service">Terms of Service</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/content-policy">Content Policy</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/community-guidelines">Community Guidelines</Link></li>
            </ul>
          </div>

          {sections.map((s) => (
            <section key={s.title} className="space-y-2">
              <h2 className="text-lg sm:text-xl font-black text-slate-900">{s.title}</h2>
              {s.body}
            </section>
          ))}

          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <p className="font-semibold text-slate-800">
              Reminder: People Power provides tools for organizing; you’re responsible for your actions online and offline.
              Always prioritize safety, verify information, and avoid sharing sensitive personal data.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
