import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Circle, Clock, Plus, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { entities } from "@/api/appClient";
import { useAuth } from '@/auth/AuthProvider';
import { upsertNotification } from '@/api/notificationsClient';

export default function TaskManager({ movementId, currentUser, canEdit }) {
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', assigned_to: '', due_date: '' });
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  const { data: tasks = [] } = useQuery({
    queryKey: ['movementTasks', movementId],
    queryFn: async () => {
      return entities.MovementTask.filter({ movement_id: movementId }, '-created_date', {
        limit: 200,
        fields: ['id', 'movement_id', 'title', 'description', 'assigned_to', 'due_date', 'status', 'created_date'],
      });
    }
  });

  const { data: collaborators = [] } = useQuery({
    queryKey: ['collaborators', movementId],
    queryFn: async () => {
      const collabs = await entities.Collaborator.filter({ movement_id: movementId }, null, {
        limit: 200,
        fields: ['id', 'movement_id', 'user_email', 'status', 'role'],
      });
      return collabs.filter(c => c.status === 'accepted');
    }
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      await entities.MovementTask.create({
        movement_id: movementId,
        title: newTask.title,
        description: newTask.description,
        assigned_to: newTask.assigned_to || null,
        due_date: newTask.due_date || null,
        created_by: currentUser.email,
        status: 'todo'
      });

      // Notify assigned user
      if (newTask.assigned_to && newTask.assigned_to !== currentUser.email) {
        try {
          if (accessToken) {
            await upsertNotification(
              {
                recipient_email: newTask.assigned_to,
                type: 'movement_update',
                actor_email: currentUser.email,
                actor_name: currentUser.full_name || currentUser.email,
                content_id: movementId,
                content_title: `assigned you a task: ${newTask.title}`,
              },
              { accessToken }
            );
          }
        } catch {
          // ignore
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movementTasks'] });
      setNewTask({ title: '', description: '', assigned_to: '', due_date: '' });
      setShowForm(false);
      toast.success('Task created!');
    }
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ taskId, status }) => {
      await entities.MovementTask.update(taskId, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movementTasks'] });
    }
  });

  const getStatusIcon = (status) => {
    switch(status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'in_progress': return <Clock className="w-5 h-5 text-blue-600" />;
      default: return <Circle className="w-5 h-5 text-slate-400" />;
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <Button
          onClick={() => setShowForm(!showForm)}
          className="w-full bg-[#3A3DFF] hover:bg-[#2A2DDD] rounded-xl font-bold"
        >
          <Plus className="w-4 h-4 mr-2" />
          {showForm ? 'Cancel' : 'Add Task'}
        </Button>
      )}

      {showForm && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-4 bg-slate-50 rounded-xl border-2 border-slate-200 space-y-3"
        >
          <Input
            value={newTask.title}
            onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
            placeholder="Task title..."
            className="rounded-lg border-2"
          />
          <Textarea
            value={newTask.description}
            onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
            placeholder="Description..."
            className="h-20 rounded-lg border-2 resize-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <Select value={newTask.assigned_to} onValueChange={(v) => setNewTask({ ...newTask, assigned_to: v })}>
              <SelectTrigger className="rounded-lg border-2">
                <SelectValue placeholder="Assign to..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Unassigned</SelectItem>
                {collaborators.map((c) => (
                  <SelectItem key={c.id} value={c.user_email}>{c.user_email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={newTask.due_date}
              onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
              className="rounded-lg border-2"
            />
          </div>
          <Button
            onClick={() => createTaskMutation.mutate()}
            disabled={!newTask.title || createTaskMutation.isPending}
            className="w-full bg-green-600 hover:bg-green-700 rounded-lg font-bold"
          >
            {createTaskMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Task'}
          </Button>
        </motion.div>
      )}

      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-8">No tasks yet</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className="p-4 bg-white rounded-xl border-2 border-slate-200">
              <div className="flex items-start gap-3">
                {canEdit ? (
                  <Select
                    value={task.status}
                    onValueChange={(status) => updateStatusMutation.mutate({ taskId: task.id, status })}
                  >
                    <SelectTrigger className="w-10 h-10 p-0 border-0">
                      <div className="flex items-center justify-center w-full">
                        {getStatusIcon(task.status)}
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todo">To Do</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  getStatusIcon(task.status)
                )}
                <div className="flex-1">
                  <h4 className={cn("font-bold text-slate-900 mb-1", task.status === 'completed' && "line-through text-slate-500")}>
                    {task.title}
                  </h4>
                  {task.description && (
                    <p className="text-sm text-slate-600 mb-2">{task.description}</p>
                  )}
                  <div className="flex gap-3 text-xs text-slate-500">
                    {task.assigned_to && <span>👤 {task.assigned_to}</span>}
                    {task.due_date && <span>📅 {format(new Date(task.due_date), 'MMM d')}</span>}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}