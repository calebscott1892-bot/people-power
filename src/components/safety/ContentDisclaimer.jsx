import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import { cn } from "@/lib/utils";

export default function ContentDisclaimer({ type = 'default', className }) {
  const disclaimers = {
    default: {
      icon: Info,
      text: 'Community-generated content. Not verified by People Power.',
      bgColor: 'bg-slate-50',
      borderColor: 'border-slate-200',
      textColor: 'text-slate-700',
      iconColor: 'text-slate-500'
    },
    event: {
      icon: AlertTriangle,
      text: 'Community-generated event. Not verified by People Power. Always act safely and responsibly.',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      textColor: 'text-yellow-900',
      iconColor: 'text-yellow-600'
    },
    challenge: {
      icon: AlertTriangle,
      text: 'Participation is at your own discretion. Complete challenges safely and legally.',
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
      textColor: 'text-orange-900',
      iconColor: 'text-orange-600'
    },
    points: {
      icon: Info,
      text: 'Points are non-financial and cannot be redeemed for real goods or services.',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-200',
      textColor: 'text-purple-900',
      iconColor: 'text-purple-600'
    }
  };

  const config = disclaimers[type] || disclaimers.default;
  const Icon = config.icon;

  return (
    <div className={cn(
      `flex items-start gap-3 p-3 rounded-xl border-2`,
      config.bgColor,
      config.borderColor,
      className
    )}>
      <Icon className={cn("w-4 h-4 flex-shrink-0 mt-0.5", config.iconColor)} />
      <p className={cn("text-xs font-bold leading-relaxed", config.textColor)}>
        {config.text}
      </p>
    </div>
  );
}