import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The prefix keeps new workbench utilities separate from the legacy styles.
const mergeClasses = extendTailwindMerge({ prefix: 'hdi' });

export function cn(...inputs: ClassValue[]): string {
  return mergeClasses(clsx(inputs));
}
