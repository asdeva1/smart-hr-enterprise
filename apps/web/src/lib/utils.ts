import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Joins class names and resolves conflicting Tailwind utilities (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Up to two capital letters for an avatar or logo placeholder: "Acme Health" → "AH", "Acme" → "AC". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const [first = '', second = ''] = parts;
  return (parts.length > 1 ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2)).toUpperCase();
}
