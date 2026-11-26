import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './Button.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'secondary' | 'primary' };

// A pill button: Create room, Copy link, Generate, Regenerate.
export function Button({ variant = 'secondary', className, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.button, variant === 'primary' ? styles.primary : '', className ?? ''].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  // What the button does, for screen readers and as a tooltip: icon buttons have no visible text.
  label: string;
  children: ReactNode;
  round?: boolean;
};

// A square (or round) button holding only an icon: toolbar tools, menus, close.
export function IconButton({ label, round = false, className, type = 'button', children, ...rest }: IconButtonProps) {
  const classes = [styles.icon, round ? styles.round : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button type={type} aria-label={label} title={label} className={classes} {...rest}>
      {children}
    </button>
  );
}

// A placeholder for something not built yet: shown so the layout matches the design, but disabled.
export const SOON = 'Coming soon';
