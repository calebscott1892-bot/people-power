import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function LegalHub() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-gradient-to-r from-[#FFC947] to-[#FFD666] px-6 py-6 sm:px-8 sm:py-8 text-slate-900">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Legal &amp; Safety</p>
              <h1 className="text-2xl sm:text-3xl font-black leading-tight">LEGAL &amp; SAFETY HUB</h1>
              <p className="text-sm sm:text-base font-semibold mt-1 text-slate-800">
                Plain-language summaries and full policy text.
              </p>
            </div>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 border border-slate-900/20 bg-white/40 hover:bg-white/60 px-3 py-2 rounded-full"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          </div>
        </div>

        <div className="p-6 sm:p-8 space-y-6 text-slate-800">
          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Documents</h2>
            <ul className="list-disc pl-5 space-y-1 font-semibold text-slate-700">
              <li><Link className="text-[#3A3DFF] hover:underline" to="/terms-of-service">Terms of Service</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/content-policy">Content Policy</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/community-guidelines">Community Guidelines</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/privacy-policy">Privacy Policy</Link></li>
              <li><Link className="text-[#3A3DFF] hover:underline" to="/safety-faq">Safety &amp; Moderation FAQ</Link></li>
            </ul>
          </section>

          <section id="reporting" className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Reporting</h2>
            <p className="text-sm sm:text-base text-slate-700 font-semibold">
              To report a movement, comment, or profile, use the in-product Report button on that item.
              Your identity is kept private from the reported user.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900">Safety Resources</h2>
            <p className="text-sm sm:text-base text-slate-700 font-semibold">
              If you’re in immediate danger, contact your local emergency services. For other concerns, prioritize safety, verify information, and avoid sharing sensitive personal data.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}