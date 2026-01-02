import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shield, Edit3, Eye, X, Loader2 } from 'lucide-react';
import { toast } from "sonner";
import { useAuth } from '@/auth/AuthProvider';
import { listMovementCollaborators, updateCollaboratorRole, removeCollaborator } from '@/api/collaboratorsClient';

export default function CollaboratorsList({ movementId, isOwner }) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const accessToken = session?.access_token || null;

  const { data: collaborators = [], isLoading } = useQuery({
    queryKey: ['collaborators', movementId],
    queryFn: async () => {
      if (!accessToken) return [];
      const collabs = await listMovementCollaborators(movementId, { accessToken });
      return (Array.isArray(collabs) ? collabs : []).filter((c) => String(c?.status || '') === 'accepted');
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ collabId, newRole }) => {
      if (!accessToken) throw new Error('Authentication required');
      await updateCollaboratorRole(collabId, newRole, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
      toast.success('Role updated');
    }
  });

  const removeMutation = useMutation({
    mutationFn: async (collabId) => {
      if (!accessToken) throw new Error('Authentication required');
      await removeCollaborator(collabId, { accessToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collaborators'] });
      toast.success('Collaborator removed');
    }
  });

  const getRoleIcon = (role) => {
    switch(role) {
      case 'admin': return <Shield className="w-4 h-4 text-red-600" />;
      case 'editor': return <Edit3 className="w-4 h-4 text-blue-600" />;
      case 'viewer': return <Eye className="w-4 h-4 text-slate-600" />;
      default: return null;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 text-[#3A3DFF] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {collaborators.length === 0 ? (
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
          No collaborators yet.
        </div>
      ) : null}
      {collaborators.map((collab) => (
        <div key={collab.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border-2 border-slate-200">
          <div className="flex items-center gap-3">
            {getRoleIcon(collab.role)}
            <div>
              <p className="font-bold text-slate-900">
                {String(collab?.display_name || '').trim()
                  ? String(collab.display_name)
                  : String(collab?.username || '').trim()
                    ? `@${String(collab.username).replace(/^@+/, '')}`
                    : 'Collaborator'}
              </p>
              <p className="text-xs text-slate-500 font-semibold capitalize">{collab.role}</p>
            </div>
          </div>

          {isOwner && (
            <div className="flex items-center gap-2">
              <Select
                value={collab.role}
                onValueChange={(newRole) => updateRoleMutation.mutate({ collabId: collab.id, newRole })}
              >
                <SelectTrigger className="w-32 h-9 text-xs rounded-lg border-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeMutation.mutate(collab.id)}
                className="h-9 w-9 text-red-600 hover:bg-red-50"
                aria-label="Remove collaborator"
                title="Remove collaborator"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}