import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    // Generic passthrough wrapper — every call site supplies its own `htmlFor` + text
    // (or wraps a control as children).
    // biome-ignore lint/a11y/noLabelWithoutControl: see comment above
    <label
      className={cn('text-sm font-medium leading-none text-neutral-900', className)}
      {...props}
    />
  );
}
