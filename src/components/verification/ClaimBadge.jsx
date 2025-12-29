import React from 'react';
import { MessageCircle, User, Megaphone, FileText, AlertCircle } from 'lucide-react';
import { cn } from "@/lib/utils";

const claimConfig = {
  opinion: {
    label: 'Opinion',
    icon: MessageCircle,
    color: 'bg-blue-100 text-blue-700 border-blue-300'
  },
  personal_experience: {
    label: 'Personal Experience',
    icon: User,
    color: 'bg-purple-100 text-purple-700 border-purple-300'
  },
  call_to_action: {
    label: 'Call to Action',
    icon: Megaphone,
    color: 'bg-orange-100 text-orange-700 border-orange-300'
  },
  factual_assertion: {
    label: 'Factual Assertion',
    icon: FileText,
    color: 'bg-yellow-100 text-yellow-700 border-yellow-300'
  }
};

export default function ClaimBadge({ claimType, hasEvidence, className }) {
  const config = claimConfig[claimType] || claimConfig.opinion;
  const Icon = config.icon;

  return (
    <div className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      <div className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border-2",
        config.color
      )}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </div>

      {claimType === 'factual_assertion' && !hasEvidence && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border-2 bg-red-100 text-red-700 border-red-300">
          <AlertCircle className="w-3.5 h-3.5" />
          Unverified
        </div>
      )}

      {claimType === 'factual_assertion' && hasEvidence && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border-2 bg-orange-100 text-orange-700 border-orange-300">
          <FileText className="w-3.5 h-3.5" />
          Evidence Provided (User-Submitted)
        </div>
      )}
    </div>
  );
}