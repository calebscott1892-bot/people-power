import React, { useState } from 'react';
import { Download, Share2, FileText, TrendingUp, Users, Target, Calendar } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from 'date-fns';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export default function PublicImpactReport({ movement }) {
  const [generating, setGenerating] = useState(false);

  const generatePDF = async () => {
    setGenerating(true);
    try {
      const element = document.getElementById('impact-report-content');
      const canvas = await html2canvas(element, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(`${movement.title.replace(/\s+/g, '_')}_Impact_Report.pdf`);
      
      toast.success('Report downloaded!');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const shareReport = async () => {
    const text = `Impact Report: ${movement.title}\n\n` +
      `📊 Momentum Score: ${movement.momentum_score || 0}\n` +
      `👥 Participants: ${(movement.verified_participants || 0) + (movement.unverified_participants || 0)}\n` +
      `🚀 Boosts: ${movement.boosts || 0}\n\n` +
      `View full movement: ${window.location.origin}/MovementDetails?id=${movement.id}`;

    if (navigator.share) {
      await navigator.share({ title: `${movement.title} - Impact Report`, text });
    } else {
      await navigator.clipboard.writeText(text);
      toast.success('Report summary copied!');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-black text-slate-900">Public Impact Report</h3>
          <p className="text-sm text-slate-600">Share your movement&apos;s progress</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={shareReport}
            variant="outline"
            className="rounded-xl font-bold border-2"
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
          <Button
            onClick={generatePDF}
            disabled={generating}
            className="bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
          >
            <Download className="w-4 h-4 mr-2" />
            {generating ? 'Generating...' : 'Download PDF'}
          </Button>
        </div>
      </div>

      {/* Report Content */}
      <div id="impact-report-content" className="bg-white rounded-2xl p-8 border-2 border-slate-200">
        {/* Header */}
        <div className="text-center mb-8 pb-6 border-b-2 border-slate-200">
          <div className="w-16 h-16 bg-gradient-to-br from-[#3A3DFF] to-[#5B5EFF] rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">{movement.title}</h1>
          <p className="text-slate-600 font-bold">Impact Report</p>
          <p className="text-sm text-slate-500 mt-2">
            Generated {format(new Date(), 'MMMM d, yyyy')}
          </p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          <div className="bg-gradient-to-br from-indigo-50 to-white p-6 rounded-xl border-2 border-indigo-200 text-center">
            <TrendingUp className="w-8 h-8 text-[#3A3DFF] mx-auto mb-2" />
            <div className="text-3xl font-black text-[#3A3DFF] mb-1">
              {movement.momentum_score || 0}
            </div>
            <div className="text-sm font-bold text-slate-600">Momentum Score</div>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-white p-6 rounded-xl border-2 border-purple-200 text-center">
            <Users className="w-8 h-8 text-purple-600 mx-auto mb-2" />
            <div className="text-3xl font-black text-purple-600 mb-1">
              {(movement.verified_participants || 0) + (movement.unverified_participants || 0)}
            </div>
            <div className="text-sm font-bold text-slate-600">Total Participants</div>
          </div>

          <div className="bg-gradient-to-br from-yellow-50 to-white p-6 rounded-xl border-2 border-yellow-200 text-center">
            <Target className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
            <div className="text-3xl font-black text-yellow-600 mb-1">
              {movement.boosts || 0}
            </div>
            <div className="text-sm font-bold text-slate-600">Community Boosts</div>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-white p-6 rounded-xl border-2 border-green-200 text-center">
            <Calendar className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <div className="text-3xl font-black text-green-600 mb-1">
              {Math.floor((Date.now() - new Date(movement.created_date)) / (1000 * 60 * 60 * 24))}
            </div>
            <div className="text-sm font-bold text-slate-600">Days Active</div>
          </div>
        </div>

        {/* Description */}
        <div className="mb-8">
          <h2 className="text-lg font-black text-slate-900 mb-3">About This Movement</h2>
          <p className="text-slate-700 leading-relaxed">{movement.description}</p>
        </div>

        {/* Impact Goals */}
        {movement.impact_goals && movement.impact_goals.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-black text-slate-900 mb-3">Impact Goals</h2>
            <ul className="space-y-2">
              {movement.impact_goals.map((goal, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-2 h-2 bg-[#3A3DFF] rounded-full mt-2 flex-shrink-0" />
                  <span className="text-slate-700">{goal}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 border-t-2 border-slate-200 text-center">
          <p className="text-sm text-slate-500 font-bold">
            Learn more at {window.location.origin}
          </p>
        </div>
      </div>
    </div>
  );
}