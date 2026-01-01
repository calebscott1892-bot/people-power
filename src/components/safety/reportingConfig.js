export const REPORT_TUTORIAL_KEY = 'peoplepower_report_tutorial_seen';

export const REPORT_REASONS = [
  {
    value: 'harassment_or_bullying',
    label: 'Harassment or Bullying',
    description: 'Targeted harassment, intimidation, or repeated unwanted contact directed at a person or group.',
  },
  {
    value: 'hate_speech_or_discrimination',
    label: 'Hate Speech or Discrimination',
    description: 'Hate, slurs, or discrimination based on protected characteristics (or similar).',
  },
  {
    value: 'incitement_of_violence_or_harm',
    label: 'Incitement of Violence or Harm',
    description: 'Threats, calls for violence, or encouragement of physical harm or destruction.',
  },
  {
    value: 'illegal_activity_or_dangerous_conduct',
    label: 'Illegal Activity or Dangerous Conduct',
    description: 'Coordination of illegal acts or dangerous conduct that could put people at risk.',
  },
  {
    value: 'misinformation_or_deceptive_activity',
    label: 'Misinformation / Deceptive Activity',
    description: 'Deceptive claims or manipulative content that could mislead people into harm or fraud.',
  },
  {
    value: 'spam_or_scams',
    label: 'Spam or Scams',
    description: 'Spam, repetitive promotion, scams, phishing, or suspicious links.',
  },
  {
    value: 'privacy_violation_or_doxxing',
    label: 'Privacy Violation / Doxxing',
    description: 'Sharing private personal info (addresses, phone numbers, IDs) without consent.',
  },
  {
    value: 'underage_safety_concern',
    label: 'Underage Safety Concern',
    description: 'Content that raises concerns about minors’ safety or exploitation.',
  },
  {
    value: 'impersonation_or_identity_fraud',
    label: 'Impersonation / Identity Fraud',
    description: 'Pretending to be someone else, or misrepresenting identity to deceive others.',
  },
  {
    value: 'inappropriate_content',
    label: 'Inappropriate Content',
    description: 'Adult or otherwise inappropriate content that violates community safety expectations.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Anything else that does not fit the categories above (please add a short explanation).',
  },
];

export const BUG_REASONS = [
  {
    value: 'page_not_loading',
    label: 'Page not loading',
    description: 'The page is blank, stuck, or fails to render.',
  },
  {
    value: 'button_not_working',
    label: 'Button not working',
    description: 'A button or action does nothing or errors.',
  },
  {
    value: 'layout_issue',
    label: 'Layout or display issue',
    description: 'Text overlaps, content is clipped, or UI breaks on your device.',
  },
  {
    value: 'wrong_information',
    label: 'Wrong or confusing information',
    description: 'Information appears incorrect or misleading.',
  },
  {
    value: 'other',
    label: 'Other',
    description: 'Something else is not working as expected.',
  },
];

export const BUG_TITLE_MAX = 120;
export const BUG_DETAILS_MAX = 1000;
