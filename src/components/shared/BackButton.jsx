import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useBackNav } from '@/components/shared/BackNavProvider';

export default function BackButton({
  fallback = createPageUrl('Home'),
  label = 'Back',
  className = 'inline-flex items-center gap-2 text-sm font-bold text-[#3A3DFF] hover:underline',
  iconClassName = 'w-4 h-4',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { previous } = useBackNav();

  const fromLabelRaw = location.state?.fromLabel;
  const fromPath = location.state?.fromPath;
  const fromLabel = typeof fromLabelRaw === 'string' ? fromLabelRaw.replace(/^Back to\s+/i, '') : '';

  const previousLabel = previous?.label || '';
  const previousPath = previous?.path || '';

  const resolvedLabel = fromLabel
    ? `Back to ${fromLabel}`
    : previousLabel
      ? `Back to ${previousLabel}`
      : label;

  const resolvedPath = fromPath || previousPath || '';

  const handleBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
      return;
    }
    if (resolvedPath) {
      navigate(resolvedPath);
      return;
    }
    navigate(fallback);
  };

  return (
    <button type="button" onClick={handleBack} className={className}>
      <ArrowLeft className={iconClassName} />
      {resolvedLabel}
    </button>
  );
}
