import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('rounded-md border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-neutral-300 bg-neutral-50 text-neutral-800',
      success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
      warning: 'border-amber-300 bg-amber-50 text-amber-900',
      danger: 'border-red-300 bg-red-50 text-red-900',
    },
  },
  defaultVariants: { variant: 'info' },
});

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

/** `role="status"` for info/success (polite, non-interrupting), `role="alert"` for
 * warning/danger (assertive) — screen readers announce settings-save errors and
 * confirmation feedback without requiring focus to move (ER-ACC-1 baseline). */
export function Alert({ className, variant, ...props }: AlertProps) {
  const isUrgent = variant === 'warning' || variant === 'danger';
  return (
    <div
      role={isUrgent ? 'alert' : 'status'}
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  );
}
