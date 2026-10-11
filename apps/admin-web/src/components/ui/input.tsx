// Adapted from shadcn/ui's Input; native input semantics remain intact.
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.js';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(
    'hdi:box-border hdi:m-0 hdi:h-9 hdi:w-full hdi:min-w-0 hdi:rounded-md hdi:border hdi:border-solid hdi:border-input hdi:bg-background hdi:px-3 hdi:py-1 hdi:text-sm hdi:leading-5 hdi:text-foreground hdi:placeholder:text-muted-foreground hdi:disabled:cursor-not-allowed hdi:disabled:opacity-50 hdi:focus-visible:outline-2 hdi:focus-visible:outline-offset-2 hdi:focus-visible:outline-ring hdi:aria-invalid:border-destructive hdi:file:border-0 hdi:file:bg-transparent hdi:file:text-sm hdi:file:font-medium',
    className,
  )} {...props} />;
}

export { Input };
