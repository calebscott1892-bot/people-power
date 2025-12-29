import React, { useState } from 'react';
import { DollarSign, ExternalLink, Heart, CreditCard } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function DonationWidget({ movementId }) {
  const [donationLink, setDonationLink] = useState('');
  const [showAddLink, setShowAddLink] = useState(false);

  // In a real app, this would be stored in the Movement entity
  // For now, using localStorage as a simple demo
  const storedLink = localStorage.getItem(`donation_link_${movementId}`);

  const handleSaveLink = () => {
    if (donationLink.trim()) {
      localStorage.setItem(`donation_link_${movementId}`, donationLink);
      setShowAddLink(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-6 border-2 border-green-200">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
          <Heart className="w-5 h-5 text-white" fill="white" />
        </div>
        <div>
          <h3 className="text-lg font-black text-slate-900">Support This Movement</h3>
          <p className="text-sm text-slate-600">Help fund this cause</p>
        </div>
      </div>

      {!storedLink && !showAddLink ? (
        <Button
          onClick={() => setShowAddLink(true)}
          variant="outline"
          className="w-full rounded-xl border-2 border-green-300 font-bold hover:bg-green-100"
        >
          <CreditCard className="w-4 h-4 mr-2" />
          Add Donation Link
        </Button>
      ) : showAddLink ? (
        <div className="space-y-3">
          <Input
            value={donationLink}
            onChange={(e) => setDonationLink(e.target.value)}
            placeholder="https://gofundme.com/... or Patreon link"
            className="rounded-xl border-2"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => setShowAddLink(false)}
              variant="outline"
              className="flex-1 rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveLink}
              className="flex-1 bg-green-500 hover:bg-green-600 rounded-xl font-bold"
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <a
            href={storedLink}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Button className="w-full bg-green-500 hover:bg-green-600 rounded-xl font-bold">
              <DollarSign className="w-4 h-4 mr-2" />
              Donate Now
              <ExternalLink className="w-4 h-4 ml-2" />
            </Button>
          </a>
          <Button
            onClick={() => {
              setDonationLink(storedLink);
              setShowAddLink(true);
            }}
            variant="outline"
            size="sm"
            className="w-full rounded-xl font-bold text-xs"
          >
            Update Link
          </Button>
        </div>
      )}

      <p className="text-xs text-slate-500 mt-4 text-center">
        Donations go directly to external platform
      </p>
    </div>
  );
}