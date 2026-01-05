import { isAdmin } from "@/utils/staff";
import {
  checkLeadershipCap as checkLeadershipCapServer,
  registerLeadershipRole as registerLeadershipRoleServer,
  deactivateLeadershipRole as deactivateLeadershipRoleServer,
} from '@/api/leadershipClient';

// Prevents "movement monopolies" by capping simultaneous leadership roles
export const checkLeadershipCap = async (userEmail, roleType, options) => {
  const email = String(userEmail || '').trim().toLowerCase();
  if (email && isAdmin(email)) {
    return {
      can_create: true,
      current_count: 0,
      cap: Number.POSITIVE_INFINITY,
      message: null,
      bypassed: true,
    };
  }

  // Server is the source of truth.
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) {
    // Keep legacy behavior: if we can't check, don't block creation.
    return { can_create: true, current_count: 0, cap: Number.POSITIVE_INFINITY, message: null };
  }

  return checkLeadershipCapServer(roleType, { accessToken });
};

export const registerLeadershipRole = async (userEmail, roleType, movementId, options) => {
  const check = await checkLeadershipCap(userEmail, roleType, options);
  
  if (!check.can_create) {
    throw new Error(check.message);
  }

  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  return registerLeadershipRoleServer(roleType, movementId, { accessToken });
};

export const deactivateLeadershipRole = async (userEmail, roleType, movementId, options) => {
  const accessToken = options?.accessToken ? String(options.accessToken) : null;
  if (!accessToken) throw new Error('Authentication required');
  await deactivateLeadershipRoleServer(roleType, movementId, { accessToken });
};

// Reduce algorithmic advantage for dominant actors
export const applyDecentralizationBoost = (movements, userLeadershipCounts) => {
  return movements.map(movement => {
    if (isAdmin(movement?.author_email)) {
      return { ...movement };
    }
    const creatorRoleCount = userLeadershipCounts[movement.author_email] || 0;
    
    // Apply diminishing returns for users with many leadership roles
    let algorithmicPenalty = 1;
    if (creatorRoleCount > 10) {
      algorithmicPenalty = 0.7; // 30% reduction
    } else if (creatorRoleCount > 5) {
      algorithmicPenalty = 0.85; // 15% reduction
    }

    return {
      ...movement,
      momentum_score: (movement.momentum_score || 0) * algorithmicPenalty,
      _decentralization_applied: true
    };
  });
};

export default {
  checkLeadershipCap,
  registerLeadershipRole,
  deactivateLeadershipRole,
  applyDecentralizationBoost
};
