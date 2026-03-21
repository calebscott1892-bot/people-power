import React from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-32 px-4 text-center">
      <div className="text-6xl font-extrabold text-slate-200 mb-4">404</div>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Page not found</h1>
      <p className="text-sm text-slate-600 font-semibold mb-6 max-w-md">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button asChild className="bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold">
        <Link to="/">
          <Home className="w-4 h-4 mr-2" />
          Go home
        </Link>
      </Button>
    </div>
  );
}
