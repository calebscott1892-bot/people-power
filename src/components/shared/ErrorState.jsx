import React, { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { getErrorDetails, getFriendlyError, shouldShowErrorDetails } from '@/utils/friendlyErrors';

export default function ErrorState({
  error,
  onRetry,
  retryLabel,
  onReload,
  onSignIn,
  signInLabel,
  className,
  compact,
}) {
  const model = useMemo(() => getFriendlyError(error), [error]);

  const primary = (() => {
    if (model.kind === 'auth' && onSignIn) return { label: signInLabel || 'Sign in', onClick: onSignIn };
    if ((model.kind === 'offline' || model.kind === 'timeout' || model.kind === 'server' || model.kind === 'unknown') && onRetry) {
      return { label: retryLabel || 'Retry', onClick: onRetry };
    }
    return null;
  })();

  const secondary = (() => {
    if (!onReload) return null;
    // Reload is a safe fallback action for all kinds.
    return { label: 'Reload', onClick: onReload };
  })();

  const showDetails = shouldShowErrorDetails();
  const details = showDetails ? getErrorDetails(error) : null;

  return (
    <Card className={className}>
      <CardHeader className={compact ? 'p-4' : undefined}>
        <CardTitle className={compact ? 'text-base font-black' : 'text-lg font-black'}>
          {model.title}
        </CardTitle>
        <CardDescription className={compact ? 'text-sm font-semibold' : 'text-sm font-semibold'}>
          {model.description}
        </CardDescription>
      </CardHeader>

      {details ? (
        <CardContent className={compact ? 'px-4 pb-0' : undefined}>
          <pre className="text-xs overflow-auto whitespace-pre-wrap text-slate-500">{String(details)}</pre>
        </CardContent>
      ) : null}

      {primary || secondary ? (
        <CardFooter className={compact ? 'p-4 pt-4 gap-2' : 'gap-2'}>
          {primary ? (
            <Button type="button" onClick={primary.onClick}>
              {primary.label}
            </Button>
          ) : null}
          {secondary ? (
            <Button type="button" variant="outline" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  );
}
