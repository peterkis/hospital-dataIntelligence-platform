// Adapted from shadcn/ui's Badge. Callers supply the server-backed status label.
import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const badgeVariants = cva(
  'hdi:box-border hdi:inline-flex hdi:w-fit hdi:items-center hdi:gap-1 hdi:rounded hdi:border hdi:border-solid hdi:border-transparent hdi:px-2 hdi:py-0.5 hdi:text-xs hdi:font-medium hdi:leading-[18px] hdi:whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'hdi:bg-secondary hdi:text-secondary-foreground',
        outline: 'hdi:border-input hdi:bg-background hdi:text-muted-foreground',
        success: 'hdi:bg-success-muted hdi:text-success',
        warning: 'hdi:bg-warning-muted hdi:text-warning',
        destructive: 'hdi:bg-danger-muted hdi:text-destructive',
        info: 'hdi:bg-accent hdi:text-link',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, asChild = false, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'span';
  return <Component data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
