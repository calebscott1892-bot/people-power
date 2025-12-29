import React from 'react';
import { motion } from 'framer-motion';
import { Shield, Ban, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ContentPolicy() {
  const prohibited = [
    {
      title: '1. Hate, Harassment & Discrimination',
      items: [
        'Content targeting individuals or groups based on race, ethnicity, religion, gender, sexual orientation, disability, or other protected characteristics',
        'Harassment, bullying, or targeted attacks against individuals',
        'Hate symbols, slurs, or dehumanizing language',
        'Content promoting supremacist ideologies',
      ],
    },
    {
      title: '2. Violence & Threats',
      items: [
        'Threats of violence against individuals, groups, or property',
        'Content glorifying or inciting violence',
        'Instructions for creating weapons or explosives',
        'Coordinating or promoting violent actions',
        'Graphic violent imagery',
      ],
    },
    {
      title: '3. Illegal Activity',
      items: [
        'Coordinating, promoting, or facilitating illegal activities',
        'Content that violates local, state, or federal laws',
        'Drug trade, human trafficking, or other criminal enterprises',
        'Instructions for illegal acts',
      ],
    },
    {
      title: '4. Privacy Violations & Doxxing',
      items: [
        'Sharing private information (addresses, phone numbers, financial data) without consent',
        'Doxxing or threatening to expose personal information',
        'Non-consensual intimate imagery',
        'Stalking or tracking individuals',
      ],
    },
    {
      title: '5. Fraud, Scams & Impersonation',
      items: [
        'Fraudulent schemes or financial scams',
        'Impersonating individuals, organizations, or officials',
        'Phishing or attempts to steal credentials',
        'False fundraising campaigns',
        'Manipulating metrics or engagement through fake accounts',
      ],
    },
    {
      title: '6. Dangerous Challenges & Misinformation',
      items: [
        'Challenges that pose risk of injury or harm',
        'Medical misinformation that could cause harm',
        'Dangerous pranks or stunts',
        'Content promoting self-harm or eating disorders',
        'Deliberately misleading information intended to cause panic or harm',
      ],
    },
    {
      title: '7. Adult & Sexual Content',
      items: ['Pornography or sexually explicit content', 'Sexual solicitation', 'Content sexualizing minors'],
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden"
      >
        <div className="bg-gradient-to-r from-pink-600 to-rose-500 text-white px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Shield className="w-8 h-8 sm:w-10 sm:h-10" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Content Policy</p>
                <h1 className="text-2xl sm:text-3xl font-black leading-tight">CONTENT POLICY</h1>
                <p className="text-sm sm:text-base font-semibold mt-1">Keeping People Power Safe &amp; Respectful</p>
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
        </div>

        <div className="p-6 sm:p-8 space-y-6 text-slate-800 text-sm sm:text-base leading-6">
          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">PROHIBITED CONTENT</h2>
            <p>The following content is strictly forbidden and will result in immediate removal and account suspension:</p>
            {prohibited.map((block) => (
              <div key={block.title} className="space-y-1">
                <h3 className="font-black">{block.title}</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {block.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">ALLOWED CONTENT</h2>
            <p>People Power supports:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Peaceful protests and advocacy</li>
              <li>Community building and mutual aid</li>
              <li>Environmental and social causes</li>
              <li>Educational content and awareness campaigns</li>
              <li>Constructive dialogue and debate</li>
              <li>Artistic and creative expression</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Consequences for Violations</h2>
            <p>Violations of this Content Policy may result in:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Content removal — Immediate deletion of violating posts</li>
              <li>Account warnings — Formal notification of policy violations</li>
              <li>Account suspension — Temporary or permanent ban from the platform</li>
              <li>Law enforcement notification — Reporting illegal activity to authorities</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">How to Report Violations</h2>
            <p>If you see content that violates this policy:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Click the &quot;Report&quot; button on the content</li>
              <li>Select the appropriate violation category</li>
              <li>Provide additional details if necessary</li>
              <li>Submit your report — our team will review it promptly</li>
            </ul>
            <div className="flex items-start gap-2 text-rose-700 font-semibold">
              <Ban className="w-5 h-5 mt-0.5" />
              <span>📢 Your reports help keep People Power safe. Thank you for being a responsible community member.</span>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  );
}