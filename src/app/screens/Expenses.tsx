/** The ledger: grouped by day, filterable by segment. */

import { useMemo, useState } from 'react';
import type { Expense, Id } from '../../domain/types.js';
import { CATEGORIES } from '../../domain/types.js';
import { useApp } from '../state.js';
import { Avatar, Empty, Money, formatDay } from '../ui.js';
import { ExpenseEditor } from './ExpenseEditor.js';

const ICONS = new Map(CATEGORIES.map((entry) => [entry.id, entry.icon]));

export function Expenses(): JSX.Element {
  const { snapshot, memberById, me } = useApp();
  const [segmentId, setSegmentId] = useState<Id | 'all'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Expense | undefined>(undefined);

  const filtered = useMemo(() => {
    if (!snapshot) return [];
    const needle = query.trim().toLowerCase();
    return snapshot.expenses.filter((expense) => {
      if (segmentId !== 'all' && expense.segmentId !== segmentId) return false;
      if (!needle) return true;
      return expense.description.toLowerCase().includes(needle);
    });
  }, [snapshot, segmentId, query]);

  const byDay = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const expense of filtered) {
      const day = expense.spentAt.slice(0, 10);
      const bucket = groups.get(day);
      if (bucket) bucket.push(expense);
      else groups.set(day, [expense]);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  if (!snapshot) return <Empty title="No trip loaded" />;
  const base = snapshot.trip.baseCurrency;

  return (
    <>
      <div className="chips" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className="chip"
          aria-pressed={segmentId === 'all'}
          onClick={() => setSegmentId('all')}
        >
          All
        </button>
        {snapshot.segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            className="chip"
            aria-pressed={segmentId === segment.id}
            onClick={() => setSegmentId(segment.id)}
          >
            {segment.name}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search expenses"
        aria-label="Search expenses"
        style={{
          width: '100%',
          padding: '10px 12px',
          border: '1px solid var(--line)',
          borderRadius: 10,
          background: 'var(--surface)',
          marginBottom: 4,
          minHeight: 44,
        }}
      />

      {byDay.length === 0 ? (
        <Empty title="Nothing here yet">
          {query || segmentId !== 'all'
            ? 'No expenses match that filter.'
            : 'Add the first expense with the button below.'}
        </Empty>
      ) : (
        byDay.map(([day, items]) => (
          <div className="daygroup" key={day}>
            <div className="dayhead">{formatDay(`${day}T12:00:00Z`)}</div>
            <div className="card">
              {items.map((expense) => {
                const payer = memberById.get(expense.payers[0]?.memberId ?? '');
                const mine = me
                  ? (expense.splits.find((s) => s.memberId === me.id)?.amountBaseMinor ?? 0)
                  : 0;
                const iPaid = me ? expense.payers.some((p) => p.memberId === me.id) : false;
                return (
                  <button
                    key={expense.id}
                    type="button"
                    className="row"
                    onClick={() => setEditing(expense)}
                  >
                    <span className="cat" aria-hidden="true">
                      {ICONS.get(expense.category) ?? '📌'}
                    </span>
                    <span className="grow">
                      <span className="title">
                        {expense.description}{' '}
                        {expense.isPrepaid ? <span className="badge prepaid">Booked</span> : null}
                      </span>
                      <span className="sub">
                        {payer ? `${payer.shortName} paid` : 'Unknown payer'}
                        {expense.currency !== base
                          ? ` · ${expense.currency} ${expense.amountMinor}`
                          : ''}
                        {me && mine > 0 ? (
                          <>
                            {' · '}
                            {iPaid ? 'your share ' : 'you owe '}
                            <Money minor={mine} currency={base} />
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="amount">
                      <Money minor={expense.amountBaseMinor} currency={base} />
                      <span className="sub">
                        {expense.splits.length} {expense.splits.length === 1 ? 'person' : 'people'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}

      {editing ? (
        <ExpenseEditor existing={editing} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
}

export function MembersStrip(): JSX.Element {
  const { memberViews } = useApp();
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {memberViews.slice(0, 6).map((member) => (
        <Avatar key={member.id} member={member} small />
      ))}
    </div>
  );
}
