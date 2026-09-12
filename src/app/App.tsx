import { useState } from 'react';
import { createTrip } from '../data/repo.js';
import { useApp } from './state.js';
import { Empty, Sheet } from './ui.js';
import { Balances } from './screens/Balances.js';
import { Expenses } from './screens/Expenses.js';
import { ExpenseEditor } from './screens/ExpenseEditor.js';
import { SettleUp } from './screens/SettleUp.js';
import { Manage } from './screens/Manage.js';

type Tab = 'balances' | 'expenses' | 'settle' | 'manage';

const TABS: { id: Tab; label: string; glyph: string }[] = [
  { id: 'balances', label: 'Balances', glyph: '⚖️' },
  { id: 'expenses', label: 'Expenses', glyph: '🧾' },
  { id: 'settle', label: 'Settle up', glyph: '✅' },
  { id: 'manage', label: 'Manage', glyph: '⚙️' },
];

function TripSwitcher({ onClose }: { onClose: () => void }): JSX.Element {
  const { trips, snapshot, selectTrip, refresh } = useApp();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('MYR');
  const [startsOn, setStartsOn] = useState(new Date().toISOString().slice(0, 10));
  const [endsOn, setEndsOn] = useState(new Date().toISOString().slice(0, 10));
  const [names, setNames] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  async function create(): Promise<void> {
    setError(undefined);
    try {
      const trip = await createTrip({
        name,
        baseCurrency: currency,
        startsOn,
        endsOn,
        memberNames: names.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
      });
      await refresh();
      selectTrip(trip.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Sheet title={creating ? 'New trip' : 'Trips'} onClose={onClose}>
      {error ? <div className="notice error">{error}</div> : null}

      {creating ? (
        <>
          <div className="card">
            <div className="field">
              <label htmlFor="trip-name">Name</label>
              <input
                id="trip-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Japan 2027"
              />
            </div>
            <div className="field">
              <label htmlFor="trip-currency">Settle in</label>
              <input
                id="trip-currency"
                type="text"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
                maxLength={3}
              />
              <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                Every balance and payment is expressed in this currency. It cannot
                be changed later without re-converting everything.
              </p>
            </div>
            <div className="field">
              <label htmlFor="trip-start">Starts</label>
              <input
                id="trip-start"
                type="date"
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="trip-end">Ends</label>
              <input
                id="trip-end"
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="trip-people">Who is coming</label>
              <textarea
                id="trip-people"
                value={names}
                onChange={(event) => setNames(event.target.value)}
                placeholder={'One name per line'}
              />
            </div>
          </div>
          <div className="btnrow">
            <button type="button" className="btn secondary" onClick={() => setCreating(false)}>
              Back
            </button>
            <button
              type="button"
              className="btn"
              disabled={!name.trim() || !names.trim()}
              onClick={() => void create()}
            >
              Create
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="card">
            {trips.map((trip) => (
              <button
                key={trip.id}
                type="button"
                className="row"
                onClick={() => {
                  selectTrip(trip.id);
                  onClose();
                }}
              >
                <span className="grow">
                  <span className="title">{trip.name}</span>
                  <span className="sub">
                    {trip.startsOn} → {trip.endsOn} · settles in {trip.baseCurrency}
                  </span>
                </span>
                {snapshot?.trip.id === trip.id ? <span className="badge">Open</span> : null}
              </button>
            ))}
          </div>
          <div className="btnrow">
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              New trip
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

export function App(): JSX.Element {
  const { loading, error, snapshot } = useApp();
  const [tab, setTab] = useState<Tab>('balances');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  if (loading) {
    return (
      <div className="app">
        <div className="content">
          <Empty title="Loading…" />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="trip-switch" onClick={() => setSwitcherOpen(true)}>
          <span className="label">{snapshot?.trip.name ?? 'Trip Splitter'}</span>
          <span className="caret" aria-hidden="true">
            ▼
          </span>
        </button>
        <span className="spacer" />
        {snapshot ? <span className="iconbtn">{snapshot.trip.baseCurrency}</span> : null}
      </header>

      <main className="content">
        {error ? <div className="notice error">{error}</div> : null}
        {!snapshot ? (
          <Empty title="No trips yet">Create one from the menu above.</Empty>
        ) : tab === 'balances' ? (
          <Balances />
        ) : tab === 'expenses' ? (
          <Expenses />
        ) : tab === 'settle' ? (
          <SettleUp />
        ) : (
          <Manage />
        )}
      </main>

      {snapshot && (tab === 'balances' || tab === 'expenses') ? (
        <button type="button" className="fab" onClick={() => setAdding(true)}>
          + Add expense
        </button>
      ) : null}

      <nav className="tabs" aria-label="Sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            {...(tab === entry.id ? { 'aria-current': 'page' as const } : {})}
          >
            <span className="glyph" aria-hidden="true">
              {entry.glyph}
            </span>
            {entry.label}
          </button>
        ))}
      </nav>

      {switcherOpen ? <TripSwitcher onClose={() => setSwitcherOpen(false)} /> : null}
      {adding ? <ExpenseEditor onClose={() => setAdding(false)} /> : null}
    </div>
  );
}
