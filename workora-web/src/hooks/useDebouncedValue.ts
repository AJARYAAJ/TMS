import { useEffect, useState } from 'react';

/** Returns `value` once it has stopped changing for `delay` ms (so typing "Payment" sends one request, not seven). */
export function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
