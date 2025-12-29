import React, { useState } from 'react';
import { Info, MessageCircle, User, Megaphone, FileText, AlertCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import { motion } from 'framer-motion';

const claimTypes = [
  {
    id: 'opinion',
    label: 'Opinion',
    icon: MessageCircle,
    description: 'A personal viewpoint or belief',
    color: 'from-blue-500 to-cyan-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-300'
  },
  {
    id: 'personal_experience',
    label: 'Personal Experience',
    icon: User,
    description: 'Based on your own lived experience',
    color: 'from-purple-500 to-pink-500',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-300'
  },
  {
    id: 'call_to_action',
    label: 'Call to Action',
    icon: Megaphone,
    description: 'Encouraging others to take specific action',
    color: 'from-orange-500 to-red-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-300'
  },
  {
    id: 'factual_assertion',
    label: 'Factual Assertion',
    icon: FileText,
    description: 'Making claims about verifiable facts',
    color: 'from-yellow-500 to-orange-500',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-300'
  }
];

export default function ClaimTypeSelector({ value, onChange }) {
  const [selectedType, setSelectedType] = useState(value);

  const handleSelect = (typeId) => {
    setSelectedType(typeId);
    onChange(typeId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-4 bg-blue-50 border-2 border-blue-200 rounded-xl">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-bold text-blue-900 text-sm mb-1">Classify Your Movement</p>
          <p className="text-xs text-slate-600">
            Help readers understand what kind of claims you&apos;re making. This classification appears on your movement page.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {claimTypes.map((type) => {
          const Icon = type.icon;
          const isSelected = selectedType === type.id;

          return (
            <motion.button
              key={type.id}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSelect(type.id)}
              className={cn(
                "p-4 rounded-xl border-3 text-left transition-all",
                isSelected
                  ? `${type.bgColor} ${type.borderColor} shadow-lg`
                  : "bg-white border-slate-200 hover:border-slate-300"
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center",
                  isSelected ? `bg-gradient-to-br ${type.color} text-white` : "bg-slate-100 text-slate-600"
                )}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="font-black text-slate-900 mb-1">{type.label}</p>
                  <p className="text-xs text-slate-600">{type.description}</p>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {selectedType === 'factual_assertion' && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-4 bg-yellow-50 border-2 border-yellow-300 rounded-xl flex items-start gap-2"
        >
          <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-yellow-900 text-sm mb-2">Factual Assertions Require Evidence</p>
            <p className="text-xs text-slate-600 mb-2">
              Your movement will be labeled as &quot;Unverified&quot; unless you provide supporting evidence. 
              All evidence is user-submitted and not verified by the platform.
            </p>
            <p className="text-xs text-slate-600 font-bold">
              The platform does not endorse, confirm, or verify any claims made by users.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}