/**
 * Home. Your netted position first, then everyone else's.
 *
 * Every figure on this screen is already netted: what you owe someone minus
 * what they owe you, never two gross numbers to subtract in your head. Tapping
 * a person opens the derivation.
 */

import { useMemo, useState } from 'react';
import type { Id } from '../../domain/types.js';
import { useApp } from '../state.js';
import { pairFor } from '../../data/repo.js';
import { Avatar, Empty, Money, Sheet, formatDay } from '../ui.js';

function WhoAmI({ onClose }: { onClose: () => void }): JSX.Element {
  const { memberViews, setMe, me } = useApp();
  return (
    <Sheet title="Who are you?" onClose={onClose}>
      <p className="muted" style={{ margin: '0 2px 12px', fontSize: 13.5 }}>
        This device will act as the person you pick. On a real invite link each
        person taps their own name once; here it just switches the point of view.
      </p>
      <div className="card">
        {memberViews.map((member) => (
          <button
            key={member.id}
            type="button"
            className="row"
            onClick={() => {
              void setMe(member.id).then(onClose);
            }}
          >
            <Avatar member={member} />
            <span className="grow">
              <span className="title">{member.name}</span>
            </span>
            {me?.id === member.id ? <span className="badge">You</span> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Derivation({ otherId, onClose }: { otherId: Id; onClose: () => void }): JSX.Element {
  const { snapshot, memberById, me } = useApp();
  const other = memberById.get(otherId);

  const pair = useMemo(() => {
    if (!snapshot || !me) return undefined;
    return pairFor(snapshot, me.id, otherId);
  }, [snapshot, me, otherId]);

  if (!snapshot || !me || !other || !pair) return <></>;
  const currency = snapshot.trip.baseCurrency;
  const owesYou = pair.netBaseMinor < 0;

  return (
    <Sheet title={`You & ${other.name}`} onClose={onClose}>
      <div className="headline" style={{ marginBottom: 12 }}>
        <div className="lede">
          {pair.netBaseMinor === 0
            ? 'You are square'
            : owesYou
              ? `${other.shortName} pays you`
              : `You pay ${other.shortName}`}
        </div>
        <div className={`figure ${owesYou ? 'pos' : pair.netBaseMinor === 0 ? '' : 'neg'}`}>
          <Money minor={Math.abs(pair.netBaseMinor)} currency={currency} />
        </div>
        <div className="sub">
          Netted from {pair.components.length}{' '}
          {pair.components.length === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      <div className="section-title">How that is worked out</div>
      <div className="card">
        <div className="derive">
          {pair.components.map((component) => (
            <div className="line" key={`${component.source}-${component.id}`}>
              <span className="what">
                <span>
                  {component.source === 'transfer'
                    ? 'Settle-up payment'
                    : (component.description ?? 'Expense')}
                </span>
                <span className="when">
                  {component.spentAt ? formatDay(component.spentAt) : ''}
                  {component.amountBaseMinor > 0
                    ? ` · you owe ${other.shortName}`
                    : ` · ${other.shortName} owes you`}
                </span>
              </span>
              <span className={`val ${component.amountBaseMinor > 0 ? '' : 'pos'}`}>
                {component.amountBaseMinor > 0 ? '' : '− '}
                <Money minor={Math.abs(component.amountBaseMinor)} currency={currency} />
              </span>
            </div>
          ))}
          <div className="total">
            <span>{owesYou ? 'They pay you' : 'You pay them'}</span>
            <span className={owesYou ? 'pos' : 'neg'}>
              <Money minor={Math.abs(pair.netBaseMinor)} currency={currency} />
            </span>
          </div>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12.5, padding: '0 2px' }}>
        Gross: you owe <Money minor={pair.aOwesB} currency={currency} />, they owe{' '}
        <Money minor={pair.bOwesA} currency={currency} />.
      </p>
    </Sheet>
  );
}

export function Balances(): JSX.Element {
  const { snapshot, memberViews, balances, me } = useApp();
  const [whoOpen, setWhoOpen] = useState(false);
  const [pairWith, setPairWith] = useState<Id | undefined>(undefined);

  if (!snapshot) return <Empty title="No trip loaded" />;
  const currency = snapshot.trip.baseCurrency;
  const myBalance = me ? (balances.get(me.id) ?? 0) : 0;

  const others = memberViews
    .filter((member) => member.id !== me?.id)
    .map((member) => ({ member, net: balances.get(member.id) ?? 0 }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.member.name.localeCompare(b.member.name));

  const total = [...balances.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="headline">
        <div className="lede">
          {me ? (
            <>
              {myBalance > 0 ? 'You are owed' : myBalance < 0 ? 'You owe' : 'You are all square'}
              {' · '}
              <button
                type="button"
                onClick={() => setWhoOpen(true)}
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  color: 'var(--accent-ink)',
                  textDecoration: 'underline',
                  fontSize: 13,
                }}
              >
                {me.name}
              </button>
            </>
          ) : (
            'Nobody claimed on this device'
          )}
        </div>
        <div className={`figure ${myBalance > 0 ? 'pos' : myBalance < 0 ? 'neg' : ''}`}>
          <Money minor={Math.abs(myBalance)} currency={currency} />
        </div>
        <div className="sub">
          {snapshot.expenses.length} expenses · {memberViews.length} people
        </div>
      </div>

      <div className="section-title">Everyone else</div>
      <div className="card">
        {others.length === 0 ? (
          <Empty title="Just you so far" />
        ) : (
          others.map(({ member, net }) => (
            <button
              key={member.id}
              type="button"
              className="row"
              onClick={() => setPairWith(member.id)}
              disabled={!me}
            >
              <Avatar member={member} />
              <span className="grow">
                <span className="title">{member.name}</span>
                <span className="sub">
                  {net > 0 ? 'is owed overall' : net < 0 ? 'owes overall' : 'all square'}
                </span>
              </span>
              <span className={`amount ${net > 0 ? 'pos' : net < 0 ? 'neg' : 'muted'}`}>
                <Money minor={Math.abs(net)} currency={currency} />
              </span>
            </button>
          ))
        )}
      </div>

      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 14 }}>
        {total === 0
          ? 'Balances net to zero ✓'
          : `Balances do not net to zero (off by ${total} minor units)`}
      </p>

      {whoOpen ? <WhoAmI onClose={() => setWhoOpen(false)} /> : null}
      {pairWith ? (
        <Derivation otherId={pairWith} onClose={() => setPairWith(undefined)} />
      ) : null}
    </>
  );
}
