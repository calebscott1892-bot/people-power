import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/auth/AuthProvider';

export default function MessagesComingSoon() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="w-full">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-lg overflow-hidden">
          <div className="px-6 py-6 sm:px-8 sm:py-8 border-b border-slate-200">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
              Direct Messages are coming soon
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-700 font-semibold leading-relaxed">
              We’re upgrading messaging behind the scenes. For now, direct messages, requests and movement group chats are temporarily disabled. All other features (movements, profiles, challenges, search) still work as normal.
            </p>
          </div>

          <div className="px-6 py-6 sm:px-8 sm:py-8">
            {!user ? (
              <Button
                type="button"
                className="w-full h-12 rounded-xl font-black uppercase tracking-wide"
                onClick={() => navigate('/login')}
              >
                Sign in
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full h-12 rounded-xl font-black uppercase tracking-wide"
                onClick={() => navigate('/')}
              >
                Back to Home
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
