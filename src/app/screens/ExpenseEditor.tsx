/**
 * Add or edit an expense — the screen that decides whether anyone uses this.
 *
 * Everything that can be inherited is: the payer defaults to you, the split to
 * the last-used squad, the currency to the segment you are in. The common case
 * is type an amount, tap a category, tap Save.
 *
 * The split editor refuses to save while anything is unassigned (SPL-05). That
 * is the single most important guard in the UI: a silently unbalanced expense
 * becomes a balance nobody can reconcile a week later.
 */

import { useMemo, useState } from 'react';
import { MoneyError, convert, decimalsFor, formatAmount, parseAmount } from '../../money.js';
import { SplitError, splitExpense, rotationFor } from '../../split.js';
import { CATEGORIES, type ExpenseCategory, type Expense, type Id, type SplitMethodName } from '../../domain/types.js';
import { saveExpense, deleteExpense, type ExpenseDraft } from '../../data/repo.js';
import { useApp } from '../state.js';
import { Avatar, Money, Sheet, toDateInput } from '../ui.js';

const CURRENCIES = ['MYR', 'GBP', 'ISK', 'EUR', 'USD'];

const METHOD_LABELS: Record<SplitMethodName, string> = {
  equal: 'Equally',
  household: 'By couple',
  shares: 'Shares',
  percent: 'Percent',
  exact: 'Exact',
};

export function ExpenseEditor({
  existing,
  onClose,
}: {
  existing?: Expense;
  onClose: () => void;
}): JSX.Element {
  const { snapshot, memberViews, memberById, me, refresh } = useApp();
  const trip = snapshot?.trip;
  const base = trip?.baseCurrency ?? 'MYR';

  const defaultSquad = snapshot?.squads[0];
  const [description, setDescription] = useState(existing?.description ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? base);
  const [amountText, setAmountText] = useState(
    existing ? formatAmount(existing.amountMinor, existing.currency, { grouping: false }) : '',
  );
  const [fxRateText, setFxRateText] = useState(String(existing?.fxRate ?? 1));
  const [category, setCategory] = useState<ExpenseCategory>(existing?.category ?? 'food');
  const [payerId, setPayerId] = useState<Id>(
    existing?.payers[0]?.memberId ?? me?.id ?? (memberViews[0]?.id as Id),
  );
  const [method, setMethod] = useState<SplitMethodName>(existing?.splitMethod ?? 'equal');
  const [participantIds, setParticipantIds] = useState<Id[]>(
    existing?.splits.map((s) => s.memberId) ??
      defaultSquad?.memberIds ??
      memberViews.map((m) => m.id),
  );
  const [exactText, setExactText] = useState<Record<Id, string>>(() =>
    Object.fromEntries(
      (existing?.splits ?? []).map((s) => [
        s.memberId,
        formatAmount(s.amountMinor, existing?.currency ?? base, { grouping: false }),
      ]),
    ),
  );
  const [shareText, setShareText] = useState<Record<Id, string>>(() =>
    Object.fromEntries((existing?.splits ?? []).map((s) => [s.memberId, String(s.weight)])),
  );
  const [spentAt, setSpentAt] = useState(
    toDateInput(existing?.spentAt ?? new Date().toISOString()),
  );
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [splitOpen, setSplitOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const amountMinor = useMemo(() => {
    if (!amountText.trim()) return 0;
    try {
      return parseAmount(amountText, currency);
    } catch {
      return Number.NaN;
    }
  }, [amountText, currency]);

  const fxRate = useMemo(() => {
    const parsed = Number(fxRateText);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }, [fxRateText]);

  const baseMinor = useMemo(() => {
    if (!Number.isFinite(amountMinor) || amountMinor === 0) return 0;
    try {
      return convert(amountMinor, fxRate, currency, base);
    } catch {
      return 0;
    }
  }, [amountMinor, fxRate, currency, base]);

  const householdOf = useMemo(() => {
    const map: Record<Id, string | undefined> = {};
    for (const member of memberViews) map[member.id] = member.householdId;
    return map;
  }, [memberViews]);

  const draft: ExpenseDraft | undefined = useMemo(() => {
    if (!trip || !Number.isFinite(amountMinor) || amountMinor <= 0) return undefined;
    if (participantIds.length === 0) return undefined;
    return {
      ...(existing ? { id: existing.id } : {}),
      tripId: trip.id,
      description,
      category,
      amountMinor,
      currency,
      fxRate,
      splitMethod: method,
      participantIds,
      payerIds: [payerId],
      spentAt: new Date(`${spentAt}T09:00:00.000Z`).toISOString(),
      isPrepaid: existing?.isPrepaid ?? false,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(me ? { actorMemberId: me.id } : {}),
      ...(method === 'exact'
        ? {
            exact: Object.fromEntries(
              participantIds.map((id) => {
                const text = exactText[id] ?? '';
                let value = 0;
                try {
                  value = text.trim() ? parseAmount(text, currency) : 0;
                } catch {
                  value = Number.NaN;
                }
                return [id, value];
              }),
            ),
          }
        : {}),
      ...(method === 'shares' || method === 'percent'
        ? {
            [method === 'shares' ? 'shares' : 'percents']: Object.fromEntries(
              participantIds.map((id) => [id, Number(shareText[id] ?? 1) || 0]),
            ),
          }
        : {}),
      ...(method === 'household' ? { householdOf } : {}),
    } as ExpenseDraft;
  }, [
    trip, existing, description, category, amountMinor, currency, fxRate, method,
    participantIds, payerId, spentAt, notes, me, exactText, shareText, householdOf,
  ]);

  /** Run the real splitter so the preview and the guard cannot disagree. */
  const preview = useMemo(() => {
    if (!draft) return { lines: [], error: undefined as string | undefined };
    try {
      const lines = splitExpense({
        totalMinor: draft.amountMinor,
        participants: draft.participantIds,
        method: draft.splitMethod as 'equal',
        rotation: rotationFor(draft.id ?? 'preview'),
        ...(draft.shares ? { shares: draft.shares } : {}),
        ...(draft.percents ? { percents: draft.percents } : {}),
        ...(draft.exact ? { exact: draft.exact } : {}),
        ...(draft.householdOf ? { householdOf: draft.householdOf } : {}),
      });
      return { lines, error: undefined };
    } catch (cause) {
      const message =
        cause instanceof SplitError || cause instanceof MoneyError
          ? cause.message
          : String(cause);
      return { lines: [], error: message };
    }
  }, [draft]);

  const canSave = Boolean(draft) && !preview.error && !busy;

  async function save(): Promise<void> {
    if (!draft || !trip) return;
    setBusy(true);
    setError(undefined);
    try {
      await saveExpense(draft, trip.baseCurrency, snapshot);
      await refresh();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!existing) return;
    setBusy(true);
    await deleteExpense(existing.id, me?.id);
    await refresh();
    onClose();
  }

  const participantSet = new Set(participantIds);
  const payer = memberById.get(payerId);

  return (
    <Sheet title={existing ? 'Edit expense' : 'Add expense'} onClose={onClose}>
      {error ? <div className="notice error">{error}</div> : null}

      <div className="card">
        <div className="amount-field">
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            aria-label="Currency"
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <input
            inputMode="decimal"
            autoFocus
            placeholder="0"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            aria-label="Amount"
          />
        </div>
        {currency !== base ? (
          <div className="conversion">
            ≈ <Money minor={baseMinor} currency={base} /> at{' '}
            <input
              value={fxRateText}
              onChange={(event) => setFxRateText(event.target.value)}
              inputMode="decimal"
              aria-label={`Rate, ${base} per ${currency}`}
              style={{
                width: 86,
                border: '1px solid var(--line)',
                borderRadius: 7,
                padding: '3px 6px',
                background: 'var(--surface-2)',
                textAlign: 'right',
              }}
            />
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="field">
          <label htmlFor="ex-desc">Description</label>
          <input
            id="ex-desc"
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Dinner in Reykjavík"
          />
        </div>

        <div className="field">
          <label>Paid by</label>
          <div className="chips">
            {memberViews.map((member) => (
              <button
                key={member.id}
                type="button"
                className="chip"
                aria-pressed={member.id === payerId}
                onClick={() => setPayerId(member.id)}
              >
                {member.shortName}
              </button>
            ))}
          </div>
          {payer && me && payer.id === me.id ? (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Defaults to you. Smart payer suggestions land in Phase 7.
            </p>
          ) : null}
        </div>

        <div className="field">
          <label>Split between</label>
          <button
            type="button"
            className="chip"
            aria-pressed={false}
            onClick={() => setSplitOpen(true)}
            style={{ width: '100%', textAlign: 'left' }}
          >
            {participantIds.length} {participantIds.length === 1 ? 'person' : 'people'} ·{' '}
            {METHOD_LABELS[method]}
            {preview.error ? ' · needs attention' : ''}
          </button>
          <div className="chips" style={{ marginTop: 7 }}>
            {(snapshot?.squads ?? []).map((squad) => {
              const active =
                squad.memberIds.length === participantIds.length &&
                squad.memberIds.every((id) => participantSet.has(id));
              return (
                <button
                  key={squad.id}
                  type="button"
                  className="chip"
                  aria-pressed={active}
                  onClick={() => setParticipantIds([...squad.memberIds])}
                >
                  {squad.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="catrow" role="group" aria-label="Category">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === category}
              aria-label={entry.label}
              title={entry.label}
              onClick={() => setCategory(entry.id)}
            >
              {entry.icon}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="ex-date">Date</label>
          <input
            id="ex-date"
            type="date"
            value={spentAt}
            onChange={(event) => setSpentAt(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="ex-notes">Notes</label>
          <textarea
            id="ex-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      {preview.error ? <div className="notice error">{preview.error}</div> : null}

      <div className="btnrow">
        <button type="button" className="btn" disabled={!canSave} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {existing ? (
        <div className="btnrow">
          <button type="button" className="btn secondary" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      ) : null}
      {existing ? (
        <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
          Deleting hides this expense and records who did it. Nothing is destroyed.
        </p>
      ) : null}

      {splitOpen ? (
        <SplitEditor
          currency={currency}
          amountMinor={Number.isFinite(amountMinor) ? amountMinor : 0}
          method={method}
          setMethod={setMethod}
          participantIds={participantIds}
          setParticipantIds={setParticipantIds}
          exactText={exactText}
          setExactText={setExactText}
          shareText={shareText}
          setShareText={setShareText}
          previewLines={preview.lines}
          previewError={preview.error}
          onClose={() => setSplitOpen(false)}
        />
      ) : null}
    </Sheet>
  );
}

function SplitEditor(props: {
  currency: string;
  amountMinor: number;
  method: SplitMethodName;
  setMethod: (method: SplitMethodName) => void;
  participantIds: Id[];
  setParticipantIds: (ids: Id[]) => void;
  exactText: Record<Id, string>;
  setExactText: (next: Record<Id, string>) => void;
  shareText: Record<Id, string>;
  setShareText: (next: Record<Id, string>) => void;
  previewLines: { memberId: Id; amountMinor: number }[];
  previewError: string | undefined;
  onClose: () => void;
}): JSX.Element {
  const { memberViews } = useApp();
  const selected = new Set(props.participantIds);
  const byMember = new Map(props.previewLines.map((line) => [line.memberId, line.amountMinor]));

  const assigned =
    props.method === 'exact'
      ? props.participantIds.reduce((sum, id) => {
          try {
            return sum + parseAmount(props.exactText[id] ?? '0', props.currency);
          } catch {
            return sum;
          }
        }, 0)
      : props.amountMinor;
  const remaining = props.amountMinor - assigned;

  function toggle(memberId: Id): void {
    props.setParticipantIds(
      selected.has(memberId)
        ? props.participantIds.filter((id) => id !== memberId)
        : [...props.participantIds, memberId],
    );
  }

  return (
    <Sheet title="Split" onClose={props.onClose}>
      <div className="chips" style={{ marginBottom: 12 }}>
        {(Object.keys(METHOD_LABELS) as SplitMethodName[]).map((key) => (
          <button
            key={key}
            type="button"
            className="chip"
            aria-pressed={props.method === key}
            onClick={() => props.setMethod(key)}
          >
            {METHOD_LABELS[key]}
          </button>
        ))}
      </div>

      {props.method === 'household' ? (
        <div className="notice">
          Divides among <strong>wallets, not heads</strong>. Set up who is a couple
          under Manage; anyone without one counts as their own wallet.
        </div>
      ) : null}

      <div className="chips" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className="chip ghost"
          onClick={() => props.setParticipantIds(memberViews.map((m) => m.id))}
        >
          Select all
        </button>
        <button type="button" className="chip ghost" onClick={() => props.setParticipantIds([])}>
          Select none
        </button>
      </div>

      <div className="card">
        {memberViews.map((member) => {
          const on = selected.has(member.id);
          return (
            <div className={`splitline ${on ? '' : 'off'}`} key={member.id}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(member.id)}
                aria-label={member.name}
                style={{ width: 20, height: 20 }}
              />
              <Avatar member={member} small />
              <span className="name">{member.name}</span>
              {on && props.method === 'exact' ? (
                <input
                  type="number"
                  inputMode="decimal"
                  step={decimalsFor(props.currency) === 0 ? 1 : 0.01}
                  value={props.exactText[member.id] ?? ''}
                  onChange={(event) =>
                    props.setExactText({ ...props.exactText, [member.id]: event.target.value })
                  }
                  aria-label={`Amount for ${member.name}`}
                />
              ) : on && (props.method === 'shares' || props.method === 'percent') ? (
                <input
                  type="number"
                  inputMode="decimal"
                  value={props.shareText[member.id] ?? '1'}
                  onChange={(event) =>
                    props.setShareText({ ...props.shareText, [member.id]: event.target.value })
                  }
                  aria-label={`${props.method === 'shares' ? 'Shares' : 'Percent'} for ${member.name}`}
                />
              ) : on ? (
                <span className="tabular muted" style={{ fontSize: 13.5 }}>
                  {formatAmount(byMember.get(member.id) ?? 0, props.currency)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {props.method === 'exact' ? (
        <div className={`remaining ${remaining === 0 ? 'ok' : ''}`}>
          <span>{remaining === 0 ? 'Fully assigned' : 'Remaining'}</span>
          <span className="tabular">
            {formatAmount(remaining, props.currency)} {props.currency}
          </span>
        </div>
      ) : null}

      {props.previewError ? <div className="notice error">{props.previewError}</div> : null}

      <div className="btnrow">
        <button
          type="button"
          className="btn"
          disabled={Boolean(props.previewError) || props.participantIds.length === 0}
          onClick={props.onClose}
        >
          Done
        </button>
      </div>
    </Sheet>
  );
}
