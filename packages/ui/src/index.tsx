import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import type { PublicStatus } from '@media-concierge/shared';

export function StatusPill({ status }: { status: PublicStatus }) {
  const tone =
    status === 'Disponible'
      ? 'success'
      : status === 'Rechazada' || status === 'No se pudo completar'
        ? 'danger'
        : status === 'Necesita información'
          ? 'warning'
          : 'active';
  return <span className={`status-pill status-pill--${tone}`}>{status}</span>;
}

type ButtonProps = PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  }
>;

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`button button--${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function EmptyState({ icon, title, copy }: { icon: string; title: string; copy: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}
