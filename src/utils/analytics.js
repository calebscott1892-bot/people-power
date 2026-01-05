export function trackEvent(name, props) {
  try {
    const payload = props && typeof props === 'object' ? props : undefined;
    // Minimal local-only analytics hook. Replace with real analytics later.
    console.info(`[Analytics] ${name}`, payload || '');
  } catch {
    // ignore
  }
}

export function trackTutorialStart(props) {
  trackEvent('Tutorial start', props);
}

export function trackTutorialStep(props) {
  trackEvent('Tutorial step', props);
}

export function trackTutorialComplete(props) {
  trackEvent('Tutorial complete', props);
}
