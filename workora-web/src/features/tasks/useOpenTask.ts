import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Tasks open in a drawer over the current screen: `?task=ECOM-102`. The URL is shareable,
 * the back button closes the drawer, and the page underneath never reloads.
 */
export function useOpenTask() {
  const [, setParams] = useSearchParams();
  return useCallback(
    (key: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key) next.set('task', key);
          else next.delete('task');
          return next;
        },
        { replace: !key },
      ),
    [setParams],
  );
}

export function useOpenTaskKey() {
  const [params] = useSearchParams();
  return params.get('task');
}
