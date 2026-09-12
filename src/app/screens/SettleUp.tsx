/**
 * Settle up: the fewest payments that clear every balance.
 *
 * Two views, because groups disagree about this. Simplified consolidates across
 * everyone; direct keeps you paying the person you actually ate with.
 */

import { useMemo, useState } from 'react';
import type { TransferMethod } from '../../domain/types.js';
import { formatAmount } from '../../money.js';
import { directDebts } from '../../settle.js';
import {
  recordTransfer,
  settlementFor,
  toLedger,
  toLedgerTransfers,
} from '../../data/repo.js';
import { useApp } from '../state.js';
import { Avatar, Empty, Money, formatDay } from '../ui.js';

const METHODS: { id: TransferMethod; label: string }[] = [
  { id: 'bank', label: 'Bank' },
  { id: 'tng', label: 'TNG' },
  { id: 'cash', label: 'Cash' },
  { id: 'other', label: 'Other' },
];

export function SettleUp(): JSX.Element {
  const { snapshot, memberById, me, refresh } = useApp();
  const [simplified, setSimplified] = useState(true);
  const [byHousehold, setByHousehold] = useState(false);
  const [busyKey, setBusyKey] = useState<string | undefined>(undefined);
  const [method, setMethod] = useState<TransferMethod>('bank');
  const [error, setError] = useState<string | undefined>(undefined);

  const transfers = useMemo(() => {
    if (!snapshot) return [];
    try {
      return simplified
        ? settlementFor(snapshot, { byHousehold })
        : directDebts(toLedger(snapshot.expenses), toLedgerTransfers(snapshot.transfers));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return [];
    }
  }, [snapshot, simplified, byHousehold]);

  if (!snapshot) return <Empty title="No trip loaded" />;
  const base = snapshot.trip.baseCurrency;

  const directCount = directDebts(
    toLedger(snapshot.expenses),
    toLedgerTransfers(snapshot.transfers),
  ).length;

  async function markPaid(from: string, to: string, amount: number): Promise<void> {
    if (!snapshot) return;
    const key = `${from}-${to}`;
    setBusyKey(key);
    setError(undefined);
    try {
      await recordTransfer({
        tripId: snapshot.trip.id,
        fromMemberId: from,
        toMemberId: to,
        amountBaseMinor: amount,
        method,
        ...(me ? { actorMemberId: me.id } : {}),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyKey(undefined);
    }
  }

  function whatsappText(): string {
    const lines = transfers.map((transfer) => {
      const from = memberById.get(transfer.from)?.shortName ?? '?';
      const to = memberById.get(transfer.to)?.shortName ?? '?';
      return `${from} → ${to}: RM ${formatAmount(transfer.amountBaseMinor, base)}`;
    });
    return [
      `${snapshot?.trip.name ?? 'Trip'} — settle up`,
      ...lines,
      '',
      `${transfers.length} payment${transfers.length === 1 ? '' : 's'} clears everyone.`,
    ].join('\n');
  }

  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}

      <div className="headline">
        <div className="lede">To clear every balance</div>
        <div className="figure">{transfers.length}</div>
        <div className="sub">
          {transfers.length === 1 ? 'payment' : 'payments'}
          {simplified && directCount > transfers.length
            ? ` · down from ${directCount} direct debts`
            : ''}
        </div>
      </div>

      <div className="chips" style={{ margin: '12px 0' }}>
        <button
          type="button"
          className="chip"
          aria-pressed={simplified}
          onClick={() => setSimplified(true)}
        >
          Simplified
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={!simplified}
          onClick={() => setSimplified(false)}
        >
          Direct debts
        </button>
        {snapshot.households.length > 0 && simplified ? (
          <button
            type="button"
            className="chip"
            aria-pressed={byHousehold}
            onClick={() => setByHousehold((value) => !value)}
          >
            Couples as one
          </button>
        ) : null}
      </div>

      {transfers.length === 0 ? (
        <Empty title="Everyone is square">Nothing to settle.</Empty>
      ) : (
        <div className="card">
          {transfers.map((transfer) => {
            const from = memberById.get(transfer.from);
            const to = memberById.get(transfer.to);
            const key = `${transfer.from}-${transfer.to}`;
            return (
              <div className="row" key={key}>
                {from ? <Avatar member={from} /> : null}
                <span className="grow">
                  <span className="title">
                    {from?.shortName ?? '?'} → {to?.shortName ?? '?'}
                  </span>
                  <span className="sub">
                    <Money minor={transfer.amountBaseMinor} currency={base} />
                  </span>
                </span>
                <button
                  type="button"
                  className="btn small secondary"
                  disabled={busyKey === key}
                  onClick={() =>
                    void markPaid(transfer.from, transfer.to, transfer.amountBaseMinor)
                  }
                >
                  {busyKey === key ? 'Saving…' : 'Mark paid'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {transfers.length > 0 ? (
        <>
          <div className="section-title">Payment method</div>
          <div className="chips">
            {METHODS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="chip"
                aria-pressed={method === entry.id}
                onClick={() => setMethod(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <div className="btnrow">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(whatsappText());
              }}
            >
              Copy for WhatsApp
            </button>
          </div>
        </>
      ) : null}

      {snapshot.transfers.length > 0 ? (
        <>
          <div className="section-title">Already paid</div>
          <div className="card">
            {snapshot.transfers.map((transfer) => {
              const from = memberById.get(transfer.fromMemberId);
              const to = memberById.get(transfer.toMemberId);
              return (
                <div className="row" key={transfer.id}>
                  {from ? <Avatar member={from} /> : null}
                  <span className="grow">
                    <span className="title">
                      {from?.shortName ?? '?'} → {to?.shortName ?? '?'}
                    </span>
                    <span className="sub">
                      {formatDay(transfer.paidAt)} · {transfer.method}
                    </span>
                  </span>
                  <span className="amount pos">
                    <Money minor={transfer.amountBaseMinor} currency={base} />
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
