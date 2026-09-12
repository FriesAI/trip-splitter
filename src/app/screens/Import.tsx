/**
 * The import wizard.
 *
 * Four steps, in the order the information actually becomes available:
 *
 *   1. Paste or choose the sheet, and see what was understood from it.
 *   2. Say who paid each item — the one thing a planning sheet never records,
 *      and without which no balance can be computed at all.
 *   3. Reconcile against the sheet's own totals, so any disagreement surfaces
 *      here rather than in an argument in December.
 *   4. Import.
 */

import { useMemo, useRef, useState } from 'react';
import { formatAmount } from '../../money.js';
import {
  ImportError,
  planFromText,
  type ImportPlan,
} from '../../domain/import.js';
import { applyImportPlan } from '../../data/importer.js';
import { useApp } from '../state.js';
import { Money, Sheet, formatDay } from '../ui.js';

type Step = 'paste' | 'payers' | 'check';

const CURRENCIES = ['MYR', 'GBP', 'EUR', 'ISK', 'USD', 'SGD'];

export function ImportWizard({ onClose }: { onClose: () => void }): JSX.Element {
  const { selectTrip, refresh } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('paste');
  const [text, setText] = useState('');
  const [tripName, setTripName] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [startsOn, setStartsOn] = useState('2026-11-22');
  const [endsOn, setEndsOn] = useState('2026-12-06');
  const [plan, setPlan] = useState<ImportPlan | undefined>(undefined);
  const [payers, setPayers] = useState<Record<number, string>>({});
  const [meName, setMeName] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const startYear = Number(startsOn.slice(0, 4)) || new Date().getFullYear();
  const startMonth = Number(startsOn.slice(5, 7)) || 1;

  /** Parsed live, so a malformed paste says so immediately. */
  const parsed = useMemo(() => {
    if (!text.trim()) return { plan: undefined, error: undefined as string | undefined };
    try {
      return {
        plan: planFromText(text, {
          currency,
          startYear,
          startMonth,
          fallbackDate: startsOn,
        }),
        error: undefined,
      };
    } catch (cause) {
      return {
        plan: undefined,
        error: cause instanceof ImportError ? cause.message : String(cause),
      };
    }
  }, [text, currency, startYear, startMonth, startsOn]);

  function goToPayers(): void {
    if (!parsed.plan) return;
    setPlan(parsed.plan);
    setPayers({});
    setMeName(parsed.plan.people[0] ?? '');
    setStep('payers');
  }

  const allPaid = plan ? plan.items.every((item) => payers[item.column]) : false;

  async function runImport(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    setError(undefined);
    try {
      const ready: ImportPlan = {
        ...plan,
        items: plan.items.map((item) => ({ ...item, payerName: payers[item.column] as string })),
      };
      const outcome = await applyImportPlan(ready, {
        tripName: tripName.trim() || 'Imported trip',
        baseCurrency: currency,
        startsOn,
        endsOn,
        ...(meName ? { meName } : {}),
      });
      await refresh();
      selectTrip(outcome.trip.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  }

  function readFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.onerror = () => setError('could not read that file');
    reader.readAsText(file);
  }

  return (
    <Sheet title="Import a sheet" onClose={onClose}>
      {error ? <div className="notice error">{error}</div> : null}

      {step === 'paste' ? (
        <>
          <div className="notice">
            In Google Sheets choose <strong>File → Download → CSV</strong>, then
            pick the file below or paste the rows straight in. People go down the
            side, booked items across the top, and a cell wherever somebody is in
            for something.
          </div>

          <div className="card">
            <div className="field">
              <label htmlFor="imp-name">Trip name</label>
              <input
                id="imp-name"
                type="text"
                value={tripName}
                onChange={(event) => setTripName(event.target.value)}
                placeholder="Euro Trip 2026"
              />
            </div>
            <div className="field">
              <label htmlFor="imp-currency">Amounts are in</label>
              <select
                id="imp-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="imp-start">Trip starts</label>
              <input
                id="imp-start"
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                The sheet's dates carry no year. This supplies it, and a column
                dated before the start rolls into the next year.
              </p>
            </div>
            <div className="field">
              <label htmlFor="imp-end">Trip ends</label>
              <input
                id="imp-end"
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="imp-text">The sheet</label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readFile(file);
                }}
                style={{ marginBottom: 8 }}
              />
              <textarea
                id="imp-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="…or paste the rows here"
                style={{ minHeight: 120, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
              />
            </div>
          </div>

          {parsed.error ? <div className="notice error">{parsed.error}</div> : null}

          {parsed.plan ? (
            <>
              <div className="section-title">What that reads as</div>
              <div className="card">
                <div className="row">
                  <span className="grow">
                    <span className="title">{parsed.plan.people.length} people</span>
                    <span className="sub">{parsed.plan.people.join(', ')}</span>
                  </span>
                </div>
                <div className="row">
                  <span className="grow">
                    <span className="title">{parsed.plan.items.length} booked items</span>
                    <span className="sub">
                      {parsed.plan.squads.length} distinct participant sets
                    </span>
                  </span>
                  <span className="amount">
                    <Money minor={parsed.plan.grandTotalMinor} currency={currency} />
                  </span>
                </div>
                {parsed.plan.emptyColumns.length > 0 ? (
                  <div className="row">
                    <span className="grow">
                      <span className="title">
                        {parsed.plan.emptyColumns.length} unpriced, skipped
                      </span>
                      <span className="sub">{parsed.plan.emptyColumns.join(', ')}</span>
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="section-title">Items found</div>
              <div className="card">
                {parsed.plan.items.map((item) => (
                  <div className="row" key={item.column}>
                    <span className="grow">
                      <span className="title">{item.description}</span>
                      <span className="sub">
                        {formatDay(`${item.spentAt}T12:00:00Z`)} · {item.participants.length}{' '}
                        {item.participants.length === 1 ? 'person' : 'people'}
                      </span>
                    </span>
                    <span className="amount">
                      <Money minor={item.totalMinor} currency={currency} />
                    </span>
                  </div>
                ))}
              </div>

              <div className="btnrow">
                <button type="button" className="btn" onClick={goToPayers}>
                  Next — who paid?
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {step === 'payers' && plan ? (
        <>
          <div className="notice">
            <strong>A planning sheet records who owes, never who paid.</strong>{' '}
            Nothing can be worked out until this is answered, so every item needs
            a payer before the import will run.
          </div>

          <div className="card">
            <div className="field">
              <label htmlFor="imp-me">You are</label>
              <select
                id="imp-me"
                value={meName}
                onChange={(event) => setMeName(event.target.value)}
              >
                {plan.people.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="section-title">
            Who paid ({plan.items.filter((i) => payers[i.column]).length}/{plan.items.length})
          </div>
          <div className="card">
            {plan.items.map((item) => (
              <div className="field" key={item.column}>
                <label htmlFor={`payer-${item.column}`}>
                  {item.description} · {formatAmount(item.totalMinor, currency)}
                </label>
                <select
                  id={`payer-${item.column}`}
                  value={payers[item.column] ?? ''}
                  onChange={(event) =>
                    setPayers({ ...payers, [item.column]: event.target.value })
                  }
                >
                  <option value="">Nobody yet</option>
                  {plan.people.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="btnrow">
            <button type="button" className="btn secondary" onClick={() => setStep('paste')}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              disabled={!allPaid}
              onClick={() => setStep('check')}
            >
              {allPaid
                ? 'Next — check the figures'
                : `${plan.items.length - Object.keys(payers).filter((k) => payers[Number(k)]).length} left`}
            </button>
          </div>
        </>
      ) : null}

      {step === 'check' && plan ? (
        <>
          <div className="headline">
            <div className="lede">Importing</div>
            <div className="figure">
              <Money minor={plan.grandTotalMinor} currency={currency} />
            </div>
            <div className="sub">
              {plan.items.length} items · {plan.people.length} people ·{' '}
              {plan.squads.length} squads
            </div>
          </div>

          <div className="section-title">Against the sheet's own totals</div>
          {plan.declaredTotals.size === 0 ? (
            <div className="notice">
              That sheet has no TOTAL column, so there is nothing to check against.
            </div>
          ) : plan.discrepancies.length === 0 ? (
            <div className="notice">
              Every person matches their own total exactly.
            </div>
          ) : (
            <>
              <div className="notice">
                <strong>
                  {plan.discrepancies.length} of {plan.people.length} people
                </strong>{' '}
                do not match the total their own sheet shows. Small, consistent
                differences usually mean hidden decimal places behind the
                displayed figures — the line items are the truth, and those are
                what gets imported.
              </div>
              <div className="card">
                {plan.discrepancies.map((discrepancy) => (
                  <div className="row" key={discrepancy.name}>
                    <span className="grow">
                      <span className="title">{discrepancy.name}</span>
                      <span className="sub">
                        sheet says {formatAmount(discrepancy.declaredMinor, currency)}, items
                        come to {formatAmount(discrepancy.computedMinor, currency)}
                      </span>
                    </span>
                    <span
                      className={`amount ${discrepancy.differenceMinor > 0 ? 'neg' : 'pos'}`}
                    >
                      {discrepancy.differenceMinor > 0 ? '+' : '−'}
                      {formatAmount(Math.abs(discrepancy.differenceMinor), currency)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-title">Squads it will save</div>
          <div className="card">
            {plan.squads.map((squad) => (
              <div className="row" key={squad.name}>
                <span className="grow">
                  <span className="title">{squad.name}</span>
                  <span className="sub">
                    {squad.itemCount} {squad.itemCount === 1 ? 'item' : 'items'} ·{' '}
                    {squad.members.join(', ')}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="btnrow">
            <button type="button" className="btn secondary" onClick={() => setStep('payers')}>
              Back
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void runImport()}>
              {busy ? 'Importing…' : 'Import as a new trip'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            This creates a new trip. Nothing already in the app is touched.
          </p>
        </>
      ) : null}
    </Sheet>
  );
}
