import { toast } from 'sonner';
import { copyRequestDebugInfoToClipboard, getLastRequestDebugInfo } from '@/utils/requestDebug';

export function showPendingTimeoutToast({ retry } = {}) {
  toast.message('Still syncing. Tap retry if it does not finish.', {
    action: typeof retry === 'function' ? { label: 'Retry', onClick: retry } : undefined,
    cancel: {
      label: 'Copy debug info',
      onClick: async () => {
        const record = getLastRequestDebugInfo();
        const ok = await copyRequestDebugInfoToClipboard(record);
        if (!ok) toast.error('Failed to copy debug info');
        else toast.success('Debug info copied');
      },
    },
  });
}
