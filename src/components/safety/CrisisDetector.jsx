// Crisis detection utility - identifies content suggesting self-harm or severe distress
// NEVER amplifies, provides supportive resources only

const crisisKeywords = {
  self_harm: [
    'self harm', 'self-harm', 'cut myself', 'cutting myself', 'hurt myself', 
    'harm myself', 'end it all', 'suicide', 'suicidal', 'kill myself',
    'want to die', 'better off dead', 'no reason to live'
  ],
  severe_distress: [
    'cant go on', "can't go on", 'give up', 'no hope', 'hopeless',
    'worthless', 'nothing matters', 'cant take it', "can't take it"
  ],
  imminent_danger: [
    'tonight', 'right now', 'today', 'going to do it', 'final goodbye',
    'say goodbye', 'last message'
  ]
};

export const detectCrisisContent = (text) => {
  if (!text) return null;
  
  const lowerText = text.toLowerCase();
  const detected = {
    has_crisis_content: false,
    severity: 'none', // none, moderate, severe, critical
    categories: []
  };

  // Check for self-harm indicators
  const selfHarmMatches = crisisKeywords.self_harm.filter(keyword => 
    lowerText.includes(keyword)
  );
  if (selfHarmMatches.length > 0) {
    detected.has_crisis_content = true;
    detected.categories.push('self_harm');
  }

  // Check for severe distress
  const distressMatches = crisisKeywords.severe_distress.filter(keyword => 
    lowerText.includes(keyword)
  );
  if (distressMatches.length > 0) {
    detected.has_crisis_content = true;
    detected.categories.push('severe_distress');
  }

  // Check for imminent danger
  const dangerMatches = crisisKeywords.imminent_danger.filter(keyword => 
    lowerText.includes(keyword)
  );
  if (dangerMatches.length > 0) {
    detected.has_crisis_content = true;
    detected.categories.push('imminent_danger');
  }

  // Determine severity
  if (detected.categories.includes('imminent_danger') && detected.categories.includes('self_harm')) {
    detected.severity = 'critical';
  } else if (detected.categories.includes('self_harm')) {
    detected.severity = 'severe';
  } else if (detected.categories.includes('severe_distress')) {
    detected.severity = 'moderate';
  }

  return detected;
};

export default { detectCrisisContent };