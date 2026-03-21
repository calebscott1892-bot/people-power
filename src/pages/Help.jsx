import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HelpCircle, Mail, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/auth/AuthProvider';

const HELP_TOPICS = [
  {
    question: "I can't sign in to my account",
    answer:
      'Try resetting your password from the sign-in page. If you never received a verification email, use the form below to contact us.',
  },
  {
    question: "I didn't receive a verification email",
    answer:
      'Check your spam/junk folder. Verification emails come from noreply@peoplepower.app. If you still can\'t find it, contact us below.',
  },
  {
    question: 'How do I reset my password?',
    answer:
      'On the sign-in page, click "Forgot password?" and enter your email. We\'ll send a reset link. The link expires after a short time, so use it promptly.',
  },
  {
    question: 'My reset or verification link isn\u2019t working',
    answer:
      'Links expire after a short time and can only be used once. Make sure you open the link in the same browser where you requested it. If it still doesn\u2019t work, request a new one from the sign-in page.',
  },
  {
    question: 'I\u2019m getting a "session expired" message',
    answer:
      'For your security, sessions expire after a period of inactivity. Simply sign in again to continue. If this keeps happening, try clearing your browser cookies and signing in fresh.',
  },
  {
    question: 'How do I change my password?',
    answer:
      'Use the "Forgot password?" option on the sign-in page to request a new password link. After clicking the link, you can set a new password.',
  },
  {
    question: 'How do I report a safety concern?',
    answer:
      'Use the Report button on any content, or visit the Report Center. You can also contact us below for urgent safety issues.',
  },
  {
    question: 'How do I delete my account?',
    answer:
      'Contact us using the form below with your account email and a request to delete your account. We\'ll process it and confirm by email.',
  },
];

export default function Help() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedEmail || !trimmedMessage) {
      toast.error('Please fill in both fields.');
      return;
    }

    setSending(true);
    try {
      const res = await fetch('/api/auth-help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, message: trimmedMessage }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to send message');
      }

      setSent(true);
      toast.success('Message sent. We\'ll get back to you.');
    } catch (err) {
      toast.error(err?.message || 'Could not send message right now. Please try again later.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto space-y-6 py-6">
        <div className="flex items-center gap-2">
          {user ? (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to sign in
            </Link>
          )}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-slate-100">
                <HelpCircle className="w-6 h-6 text-slate-700" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Help &amp; Support</h1>
                <p className="text-sm text-slate-500 font-semibold">
                  Common questions and support
                </p>
              </div>
            </div>

            {/* FAQ accordion */}
            <div className="space-y-2">
              <h2 className="text-sm font-bold text-slate-700">Common questions</h2>
              {HELP_TOPICS.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  aria-expanded={expandedIndex === i}
                  onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 hover:bg-slate-50 transition-colors"
                >
                  <div className="text-sm font-bold text-slate-800">{topic.question}</div>
                  {expandedIndex === i ? (
                    <div className="mt-2 text-sm text-slate-600 font-semibold">
                      {topic.answer}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>

            {/* Contact form */}
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-slate-500" />
                <h2 className="text-sm font-bold text-slate-700">Contact us</h2>
              </div>
              <p className="text-xs text-slate-500 font-semibold">
                Locked out or need help with your account? Send us a message and we&apos;ll respond by email.
              </p>

              {sent ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                  Message sent. We&apos;ll get back to you at <span className="font-black">{email}</span>.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="help-email" className="text-sm font-bold text-slate-800">Your email</label>
                    <Input
                      id="help-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      disabled={sending}
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="help-message" className="text-sm font-bold text-slate-800">How can we help?</label>
                    <textarea
                      id="help-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Describe your issue (at least 10 characters)..."
                      required
                      disabled={sending}
                      rows={4}
                      minLength={10}
                      maxLength={2000}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent disabled:opacity-50"
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={sending} aria-busy={sending}>
                    {sending ? 'Sending...' : 'Send message'}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
    </div>
  );
}
