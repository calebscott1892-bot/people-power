import React from 'react';
import { createPageUrl } from '@/utils';
import BackButton from '@/components/shared/BackButton';

export default function AdminBackButton({ fallback = createPageUrl('AdminDashboard'), label = 'Back' }) {
  return <BackButton fallback={fallback} label={label} />;
}
