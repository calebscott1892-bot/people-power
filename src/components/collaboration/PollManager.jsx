import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart2, Plus, X, Loader2, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from "sonner";
import { entities } from "@/api/appClient";

function PollManagerProd() {
  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-700 font-semibold">
      Polls are temporarily disabled while we add server persistence.
    </div>
  );
}

function PollManagerDev({ movementId, currentUser, canCreatePolls }) {

  const [showForm, setShowForm] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const queryClient = useQueryClient();

  const { data: polls = [] } = useQuery({
    queryKey: ['polls', movementId],
    queryFn: async () => {
      return entities.MovementPoll.filter({ movement_id: movementId }, '-created_date', {
        limit: 200,
        fields: ['id', 'movement_id', 'question', 'options', 'votes', 'status', 'created_date', 'created_by'],
      });
    }
  });

  const createPollMutation = useMutation({
    mutationFn: async () => {
      const validOptions = options.filter(o => o.trim());
      if (validOptions.length < 2) throw new Error('Need at least 2 options');
      
      await entities.MovementPoll.create({
        movement_id: movementId,
        created_by: currentUser.email,
        question,
        options: validOptions,
        votes: {}
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polls'] });
      setQuestion('');
      setOptions(['', '']);
      setShowForm(false);
      toast.success('Poll created!');
    }
  });

  const voteMutation = useMutation({
    mutationFn: async ({ pollId, optionIndex, currentVotes }) => {
      const newVotes = { ...currentVotes };
      const optionKey = optionIndex.toString();
      
      // Remove user from all options
      Object.keys(newVotes).forEach(key => {
        newVotes[key] = (newVotes[key] || []).filter(email => email !== currentUser.email);
      });
      
      // Add user to selected option
      if (!newVotes[optionKey]) newVotes[optionKey] = [];
      newVotes[optionKey].push(currentUser.email);
      
      await entities.MovementPoll.update(pollId, { votes: newVotes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['polls'] });
    }
  });

  return (
    <div className="space-y-4">
      {canCreatePolls && (
        <Button
          onClick={() => setShowForm(!showForm)}
          className="w-full bg-purple-600 hover:bg-purple-700 rounded-xl font-bold"
        >
          <Plus className="w-4 h-4 mr-2" />
          {showForm ? 'Cancel' : 'Create Poll'}
        </Button>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-purple-50 rounded-xl p-4 border-2 border-purple-200 space-y-3"
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Poll question..."
              className="rounded-lg border-2"
            />
            
            {options.map((opt, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={opt}
                  onChange={(e) => {
                    const newOpts = [...options];
                    newOpts[i] = e.target.value;
                    setOptions(newOpts);
                  }}
                  placeholder={`Option ${i + 1}...`}
                  className="rounded-lg border-2"
                />
                {options.length > 2 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
                    aria-label={`Remove option ${i + 1}`}
                    title="Remove option"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
            
            <Button
              onClick={() => setOptions([...options, ''])}
              variant="outline"
              className="w-full rounded-lg font-bold"
              disabled={options.length >= 6}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Option
            </Button>
            
            <Button
              onClick={() => createPollMutation.mutate()}
              disabled={!question.trim() || createPollMutation.isPending}
              className="w-full bg-purple-600 hover:bg-purple-700 rounded-lg font-bold"
            >
              {createPollMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Poll'}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-3">
        {polls.length === 0 ? (
          <p className="text-center text-slate-500 py-8">No polls yet</p>
        ) : (
          polls.map(poll => (
            <PollCard
              key={poll.id}
              poll={poll}
              onVote={(optionIndex) => voteMutation.mutate({ 
                pollId: poll.id, 
                optionIndex, 
                currentVotes: poll.votes 
              })}
              currentUser={currentUser}
            />
          ))
        )}
      </div>
    </div>
  );
}

const PollManager = import.meta?.env?.DEV ? PollManagerDev : PollManagerProd;

export default PollManager;

function PollCard({ poll, onVote, currentUser }) {
  const votes = poll.votes || {};
  const totalVotes = Object.values(votes).reduce((sum, voters) => sum + (voters?.length || 0), 0);
  const userVote = Object.keys(votes).find(key => votes[key]?.includes(currentUser.email));

  return (
    <div className="bg-white rounded-xl p-4 border-2 border-slate-200">
      <div className="flex items-start gap-3 mb-4">
        <BarChart2 className="w-5 h-5 text-purple-600 flex-shrink-0 mt-1" />
        <div className="flex-1">
          <h4 className="font-black text-slate-900 mb-1">{poll.question}</h4>
          <p className="text-xs text-slate-500">{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</p>
        </div>
      </div>

      <div className="space-y-2">
        {poll.options.map((option, i) => {
          const optionVotes = votes[i.toString()]?.length || 0;
          const percentage = totalVotes > 0 ? (optionVotes / totalVotes) * 100 : 0;
          const hasVoted = userVote === i.toString();

          return (
            <button
              key={i}
              onClick={() => poll.status === 'active' && onVote(i)}
              disabled={poll.status === 'closed'}
              className="w-full text-left relative"
            >
              <div className="relative z-10 flex items-center justify-between p-3 rounded-lg border-2 border-slate-200 hover:border-purple-300 transition-colors">
                <span className="font-bold text-slate-900 flex items-center gap-2">
                  {hasVoted && <CheckCircle className="w-4 h-4 text-purple-600" />}
                  {option}
                </span>
                <span className="text-sm font-bold text-slate-600">{Math.round(percentage)}%</span>
              </div>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                className="absolute inset-y-0 left-0 bg-purple-100 rounded-lg"
                style={{ zIndex: 0 }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}