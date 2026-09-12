/** Small shared pieces. Nothing here knows about money rules. */

import { useEffect, type ReactNode } from 'react';
import { formatAmount } from '../money.js';
import { initialsOf } from '../domain/types.js';
import type { MemberView } from './state.js';

export function Avatar({
  member,
  small = false,
}: {
  member: Pick<MemberView, 'name' | 'color'>;
  small?: boolean;
}): JSX.Element {
  return (
    <span
      className={small ? 'avatar sm' : 'avatar'}
      style={{ background: member.color }}
      aria-hidden="true"
    >
      {initialsOf(member.name)}
    </span>
  );
}

/** An amount with its currency code, e.g. "RM 1,033.64". */
export function Money({
  minor,
  currency,
  signed = false,
}: {
  minor: number;
  currency: string;
  signed?: boolean;
}): JSX.Element {
  const symbol = currency === 'MYR' ? 'RM' : currency;
  const sign = signed && minor > 0 ? '+' : '';
  return (
    <span className="tabular">
      {sign}
      {minor < 0 ? '−' : ''}
      {symbol} {formatAmount(Math.abs(minor), currency)}
    </span>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  action,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  action?: ReactNode;
}): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="sheet-head">
          <h2>{title}</h2>
          {action}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DAY_FORMAT.format(date);
}

export function toDateInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toISOString().slice(0, 10);
}
