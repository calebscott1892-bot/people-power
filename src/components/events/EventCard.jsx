import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, MapPin, Video, Users, Check } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { entities } from "@/api/appClient";
import { logError } from '@/utils/logError';

const eventTypeColors = {
  rally: 'bg-red-100 text-red-700 border-red-300',
  protest: 'bg-orange-100 text-orange-700 border-orange-300',
  workshop: 'bg-blue-100 text-blue-700 border-blue-300',
  meeting: 'bg-purple-100 text-purple-700 border-purple-300',
  fundraiser: 'bg-green-100 text-green-700 border-green-300',
  online: 'bg-indigo-100 text-indigo-700 border-indigo-300',
  other: 'bg-slate-100 text-slate-700 border-slate-300'
};

export default function EventCard({ event, currentUser, isPast = false }) {
  const queryClient = useQueryClient();

  const { data: rsvp } = useQuery({
    queryKey: ['stubRsvp', event.id, currentUser?.email],
    queryFn: async () => {
      if (!currentUser) return null;
      const rsvps = await entities.EventRSVP.filter(
        {
          event_id: event.id,
          user_email: currentUser.email,
        },
        null,
        { limit: 1, offset: 0, fields: 'id,status' }
      );
      return rsvps[0] || null;
    },
    enabled: !!currentUser && !!event.id
  });

  const rsvpMutation = useMutation({
    mutationFn: async (status) => {
      if (rsvp) {
        await entities.EventRSVP.update(rsvp.id, { status });
      } else {
        await entities.EventRSVP.create({
          event_id: event.id,
          user_email: currentUser.email,
          status
        });
        
        // Update RSVP count
        await entities.Event.update(event.id, {
          rsvp_count: (event.rsvp_count || 0) + 1
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stubRsvp'] });
      queryClient.invalidateQueries({ queryKey: ['stubEvents'] });
      toast.success('RSVP updated!');
    },
    onError: (e) => {
      logError(e, 'Event RSVP failed', { eventId: event?.id });
      toast.error('Could not update RSVP. Please try again.');
    },
  });

  const title = event?.title || event?.name || 'Untitled event';

  const eventType = String(event?.event_type || 'other');
  const startDateRaw = event?.start_date || event?.starts_at || event?.start_time || null;
  const parsedStartDate = startDateRaw ? new Date(startDateRaw) : null;
  const startDateValid = !!(parsedStartDate && !Number.isNaN(parsedStartDate.getTime()));

  return (
    <div className={cn(
      "bg-white rounded-2xl p-5 border-2 border-slate-200 hover:border-[#3A3DFF] transition-all",
      isPast && "opacity-60"
    )}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={cn(
              "px-3 py-1 rounded-lg text-xs font-black uppercase border-2",
              eventTypeColors[eventType] || eventTypeColors.other
            )}>
              {eventType}
            </span>
            {isPast && (
              <span className="px-2 py-1 bg-slate-200 text-slate-600 rounded text-xs font-bold">
                Past
              </span>
            )}
          </div>
          <h4 className="text-lg font-black text-slate-900 mb-2">{title}</h4>
          {event.description && (
            <p className="text-sm text-slate-600 mb-3 line-clamp-2">{event.description}</p>
          )}
        </div>
        
        {!isPast && currentUser && (
          <div className="flex gap-2">
            <Button
              onClick={() => rsvpMutation.mutate('going')}
              disabled={rsvpMutation.isPending}
              size="sm"
              className={cn(
                "rounded-lg font-bold",
                rsvp?.status === 'going'
                  ? "bg-green-500 hover:bg-green-600"
                  : "bg-slate-200 hover:bg-slate-300 text-slate-700"
              )}
            >
              <Check className="w-4 h-4" />
            </Button>
            <Button
              onClick={() => rsvpMutation.mutate('interested')}
              disabled={rsvpMutation.isPending}
              size="sm"
              className={cn(
                "rounded-lg font-bold",
                rsvp?.status === 'interested'
                  ? "bg-blue-500 hover:bg-blue-600"
                  : "bg-slate-200 hover:bg-slate-300 text-slate-700"
              )}
            >
              ?
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-slate-600">
          <Calendar className="w-4 h-4" />
          <span className="font-bold">
            {startDateValid ? (
              <>
                {format(parsedStartDate, 'PPP')} at {format(parsedStartDate, 'p')}
              </>
            ) : (
              'Date/time not set'
            )}
          </span>
        </div>

        {event.location?.city && (
          <div className="flex items-center gap-2 text-slate-600">
            <MapPin className="w-4 h-4" />
            <span className="font-bold">
              {event.location.address && `${event.location.address}, `}
              {event.location.city}, {event.location.country}
            </span>
          </div>
        )}

        {event.virtual_link && (
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-[#3A3DFF]" />
            <a
              href={event.virtual_link}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-[#3A3DFF] hover:underline"
            >
              Join Virtual Meeting
            </a>
          </div>
        )}

        <div className="flex items-center gap-2 text-slate-600">
          <Users className="w-4 h-4" />
          <span className="font-bold">
            {event.rsvp_count || 0} going
            {event.max_attendees && ` / ${event.max_attendees} max`}
          </span>
        </div>
      </div>
    </div>
  );
}
