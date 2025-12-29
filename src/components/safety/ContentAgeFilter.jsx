// Utility to filter content based on user age and content risk level

export const getAgeFromBirthdate = (birthdate) => {
  if (!birthdate) return null;
  
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  
  return age;
};

export const shouldRestrictContent = (userAge, contentRiskLevel) => {
  if (!userAge) return false; // Don't restrict if age unknown
  
  // Age-based restrictions
  if (userAge < 13) {
    return true; // Restrict all high-risk content for under 13
  }
  
  if (userAge < 18) {
    // Restrict high-risk and graphic content for minors
    return ['high', 'very_high', 'graphic', 'violence', 'crisis'].includes(contentRiskLevel);
  }
  
  return false;
};

export const getContentRiskLevel = (movement) => {
  // Determine risk level based on tags, intensity, and content
  const riskTags = ['protest', 'boycott', 'confrontation'];
  const graphicTags = ['violence', 'graphic'];
  
  if (movement.tags) {
    if (movement.tags.some(tag => graphicTags.includes(tag.toLowerCase()))) {
      return 'graphic';
    }
    if (movement.tags.some(tag => riskTags.includes(tag.toLowerCase()))) {
      return 'high';
    }
  }
  
  // Check intensity data if available
  const description = (movement.description || '').toLowerCase();
  if (description.includes('violence') || description.includes('danger')) {
    return 'high';
  }
  
  return 'normal';
};

export const getAgeSafetySettings = (age) => {
  if (age < 13) {
    return {
      can_view_high_risk: false,
      can_create_movements: false,
      can_participate: false,
      can_comment: false,
      requires_parental_consent: true
    };
  }
  
  if (age < 18) {
    return {
      can_view_high_risk: false,
      can_create_movements: true,
      can_participate: true,
      can_comment: true,
      default_privacy: 'high',
      content_warnings: true
    };
  }
  
  return {
    can_view_high_risk: true,
    can_create_movements: true,
    can_participate: true,
    can_comment: true,
    default_privacy: 'medium'
  };
};

export default {
  getAgeFromBirthdate,
  shouldRestrictContent,
  getContentRiskLevel,
  getAgeSafetySettings
};