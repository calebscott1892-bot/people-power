import { entities } from "@/api/appClient";
import { isAdmin } from "@/utils/staff";

// Prevents "movement monopolies" by capping simultaneous leadership roles
export const checkLeadershipCap = async (userEmail, roleType) => {
  if (isAdmin(userEmail)) {
    return {
      can_create: true,
      current_count: 0,
      cap: Number.POSITIVE_INFINITY,
      message: null,
      bypassed: true,
    };
  }
  // Get platform config
  const configs = await entities.PlatformConfig.filter({ config_key: 'leadership_caps' });
  const caps = configs.length > 0 ? configs[0].config_value : {
    max_movements_created: 5,
    max_collaborator_roles: 10,
    max_events_organized: 8,
    max_petitions_created: 5
  };

  // Count current active roles
  const activeRoles = await entities.LeadershipRole.filter({
    user_email: userEmail,
    role_type: roleType,
    is_active: true
  });

  // Check against cap
  const roleCapMapping = {
    movement_creator: caps.max_movements_created,
    collaborator_admin: caps.max_collaborator_roles,
    collaborator_editor: caps.max_collaborator_roles,
    event_organizer: caps.max_events_organized,
    petition_creator: caps.max_petitions_created
  };

  const cap = roleCapMapping[roleType] || 5;
  const hasReachedCap = activeRoles.length >= cap;

  return {
    can_create: !hasReachedCap,
    current_count: activeRoles.length,
    cap: cap,
    message: hasReachedCap 
      ? `You've reached the limit of ${cap} active ${roleType.replace(/_/g, ' ')} roles. This prevents power concentration and encourages decentralization.`
      : null
  };
};

export const registerLeadershipRole = async (userEmail, roleType, movementId) => {
  const check = await checkLeadershipCap(userEmail, roleType);
  
  if (!check.can_create) {
    throw new Error(check.message);
  }

  return entities.LeadershipRole.create({
    user_email: userEmail,
    role_type: roleType,
    movement_id: movementId,
    is_active: true,
    reached_cap: false
  });
};

export const deactivateLeadershipRole = async (userEmail, roleType, movementId) => {
  const roles = await entities.LeadershipRole.filter({
    user_email: userEmail,
    role_type: roleType,
    movement_id: movementId,
    is_active: true
  });

  if (roles.length > 0) {
    await entities.LeadershipRole.update(roles[0].id, { is_active: false });
  }
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
