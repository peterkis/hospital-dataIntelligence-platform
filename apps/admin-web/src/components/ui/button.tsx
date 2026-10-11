// Adapted from shadcn/ui's Radix Button; scoped to the HDIP workbench tokens.
import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils.js';

const buttonVariants = cva(
  'hdi:box-border hdi:m-0 hdi:inline-flex hdi:shrink-0 hdi:items-center hdi:justify-center hdi:gap-2 hdi:rounded-md hdi:border hdi:border-solid hdi:border-transparent hdi:text-sm hdi:font-medium hdi:leading-5 hdi:whitespace-nowrap hdi:cursor-pointer hdi:transition-colors hdi:duration-150 hdi:focus-visible:outline-2 hdi:focus-visible:outline-offset-2 hdi:focus-visible:outline-ring hdi:disabled:cursor-not-allowed hdi:disabled:opacity-50 hdi:motion-reduce:transition-none hdi:[&_svg]:pointer-events-none hdi:[&_svg]:size-4 hdi:[&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hdi:bg-primary hdi:text-primary-foreground hdi:hover:bg-primary/90',
        outline: 'hdi:border-input hdi:bg-background hdi:text-foreground hdi:hover:bg-secondary',
        secondary: 'hdi:bg-secondary hdi:text-secondary-foreground hdi:hover:bg-muted',
        ghost: 'hdi:bg-transparent hdi:text-foreground hdi:hover:bg-secondary',
        destructive: 'hdi:bg-destructive hdi:text-white hdi:hover:bg-destructive/90',
        link: 'hdi:bg-transparent hdi:text-link hdi:underline-offset-4 hdi:hover:underline',
      },
      size: {
        default: 'hdi:h-9 hdi:px-3 hdi:py-2',
        sm: 'hdi:h-8 hdi:gap-1.5 hdi:px-2.5 hdi:py-1.5',
        lg: 'hdi:h-10 hdi:px-4 hdi:py-2',
        icon: 'hdi:size-9 hdi:p-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...(!asChild ? { type: type ?? 'button' } : {})} {...props} />;
}

export { Button, buttonVariants };
export type { ButtonProps };
