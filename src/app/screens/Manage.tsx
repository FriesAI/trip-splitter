/**
 * Manage: people, couples, squads, and the invite link.
 *
 * Everyone is an admin (GRP-02), so there is no permissions UI here at all —
 * just the things any member may change.
 */

import { useState } from 'react';
import { newId } from '../../data/db.js';
import {
  addMember,
  deleteHousehold,
  deleteSquad,
  removeMember,
  saveHousehold,
  saveSquad,
} from '../../data/repo.js';
import type { Id } from '../../domain/types.js';
import { useApp } from '../state.js';
import { Avatar, Empty, Sheet } from '../ui.js';

function SquadEditor({
  squadId,
  onClose,
}: {
  squadId?: Id;
  onClose: () => void;
}): JSX.Element {
  const { snapshot, memberViews, refresh } = useApp();
  const existing = snapshot?.squads.find((s) => s.id === squadId);
  const [name, setName] = useState(existing?.name ?? '');
  const [selected, setSelected] = useState<Id[]>(existing?.memberIds ?? []);

  async function save(): Promise<void> {
    if (!snapshot) return;
    await saveSquad({
      id: existing?.id ?? newId(),
      tripId: snapshot.trip.id,
      name: name.trim() || `Group of ${selected.length}`,
      memberIds: selected,
      sortOrder: existing?.sortOrder ?? snapshot.squads.length,
    });
    await refresh();
    onClose();
  }

  return (
    <Sheet title={existing ? 'Edit squad' : 'New squad'} onClose={onClose}>
      <div className="card">
        <div className="field">
          <label htmlFor="squad-name">Name</label>
          <input
            id="squad-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Second car"
          />
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {memberViews.map((member) => {
          const on = selected.includes(member.id);
          return (
            <div className={`splitline ${on ? '' : 'off'}`} key={member.id}>
              <input
                type="checkbox"
                checked={on}
                aria-label={member.name}
                onChange={() =>
                  setSelected(
                    on ? selected.filter((id) => id !== member.id) : [...selected, member.id],
                  )
                }
                style={{ width: 20, height: 20 }}
              />
              <Avatar member={member} small />
              <span className="name">{member.name}</span>
            </div>
          );
        })}
      </div>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          disabled={selected.length === 0}
          onClick={() => void save()}
        >
          Save squad
        </button>
      </div>
    </Sheet>
  );
}

function HouseholdEditor({ onClose }: { onClose: () => void }): JSX.Element {
  const { snapshot, memberViews, refresh } = useApp();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Id[]>([]);

  async function save(): Promise<void> {
    if (!snapshot || selected.length < 2) return;
    const id = newId();
    await saveHousehold(
      {
        id,
        tripId: snapshot.trip.id,
        name: name.trim() || 'Couple',
        settleToMemberId: selected[0] as Id,
      },
      selected,
    );
    await refresh();
    onClose();
  }

  return (
    <Sheet title="New couple" onClose={onClose}>
      <div className="notice">
        A couple shares one wallet. Splitting <strong>by couple</strong> divides
        among wallets rather than heads, and they receive a single settle-up
        payment. The first person picked receives it.
      </div>
      <div className="card">
        <div className="field">
          <label htmlFor="hh-name">Name</label>
          <input
            id="hh-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sin Yin & Khong Ming"
          />
        </div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        {memberViews.map((member) => {
          const on = selected.includes(member.id);
          return (
            <div className={`splitline ${on ? '' : 'off'}`} key={member.id}>
              <input
                type="checkbox"
                checked={on}
                aria-label={member.name}
                disabled={!on && Boolean(member.householdId)}
                onChange={() =>
                  setSelected(
                    on ? selected.filter((id) => id !== member.id) : [...selected, member.id],
                  )
                }
                style={{ width: 20, height: 20 }}
              />
              <Avatar member={member} small />
              <span className="name">{member.name}</span>
              {member.householdId && !on ? (
                <span className="badge">Already paired</span>
              ) : selected[0] === member.id ? (
                <span className="badge">Receives</span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="btnrow">
        <button
          type="button"
          className="btn"
          disabled={selected.length < 2}
          onClick={() => void save()}
        >
          Save couple
        </button>
      </div>
    </Sheet>
  );
}

export function Manage(): JSX.Element {
  const { snapshot, memberViews, refresh } = useApp();
  const [newName, setNewName] = useState('');
  const [squadOpen, setSquadOpen] = useState<{ id?: Id } | undefined>(undefined);
  const [householdOpen, setHouseholdOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  if (!snapshot) return <Empty title="No trip loaded" />;

  const inviteLink = `${
    typeof window === 'undefined' ? '' : window.location.origin
  }/join/${snapshot.trip.inviteToken}`;

  async function add(): Promise<void> {
    if (!snapshot || !newName.trim()) return;
    setError(undefined);
    try {
      await addMember(snapshot.trip.id, newName);
      setNewName('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function drop(memberId: Id): Promise<void> {
    setError(undefined);
    try {
      await removeMember(memberId);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <>
      {error ? <div className="notice error">{error}</div> : null}

      <div className="notice">
        <strong>Everyone here is an admin.</strong> Any member can add, edit or
        delete anything. Deletes are recoverable and every change is recorded, so
        that stays safe without permissions getting in the way.
      </div>

      <div className="section-title">Invite link</div>
      <div className="card">
        <div className="field">
          <label>Share into the group chat</label>
          <input type="text" readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
          <p className="muted" style={{ fontSize: 12, margin: '7px 0 0' }}>
            Joining from another phone needs the server, which lands in Phase 4.
            Until then this link only works on this device.
          </p>
        </div>
      </div>

      <div className="section-title">People ({memberViews.length})</div>
      <div className="card">
        {memberViews.map((member) => (
          <div className="row" key={member.id}>
            <Avatar member={member} />
            <span className="grow">
              <span className="title">{member.name}</span>
              {member.householdId ? (
                <span className="sub">
                  {snapshot.households.find((h) => h.id === member.householdId)?.name ?? 'Couple'}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              className="btn small secondary"
              onClick={() => void drop(member.id)}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="field">
          <label htmlFor="new-member">Add someone</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="new-member"
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name"
            />
            <button
              type="button"
              className="btn small"
              disabled={!newName.trim()}
              onClick={() => void add()}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">Couples ({snapshot.households.length})</div>
      <div className="card">
        {snapshot.households.length === 0 ? (
          <div className="field">
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              None yet. Pair two people and “by couple” splits become available.
            </p>
          </div>
        ) : (
          snapshot.households.map((household) => (
            <div className="row" key={household.id}>
              <span className="cat" aria-hidden="true">
                ⚭
              </span>
              <span className="grow">
                <span className="title">{household.name}</span>
                <span className="sub">
                  {memberViews.filter((m) => m.householdId === household.id).length} people
                </span>
              </span>
              <button
                type="button"
                className="btn small secondary"
                onClick={() => void deleteHousehold(household.id).then(refresh)}
              >
                Unpair
              </button>
            </div>
          ))
        )}
        <div className="field">
          <button type="button" className="btn small" onClick={() => setHouseholdOpen(true)}>
            New couple
          </button>
        </div>
      </div>

      <div className="section-title">Squads ({snapshot.squads.length})</div>
      <div className="card">
        {snapshot.squads.map((squad) => (
          <div className="row" key={squad.id}>
            <span className="grow">
              <span className="title">{squad.name}</span>
              <span className="sub">{squad.memberIds.length} people</span>
            </span>
            <button
              type="button"
              className="btn small secondary"
              onClick={() => setSquadOpen({ id: squad.id })}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn small secondary"
              onClick={() => void deleteSquad(squad.id).then(refresh)}
            >
              Delete
            </button>
          </div>
        ))}
        <div className="field">
          <button type="button" className="btn small" onClick={() => setSquadOpen({})}>
            New squad
          </button>
        </div>
      </div>

      {squadOpen ? (
        <SquadEditor
          {...(squadOpen.id !== undefined ? { squadId: squadOpen.id } : {})}
          onClose={() => setSquadOpen(undefined)}
        />
      ) : null}
      {householdOpen ? <HouseholdEditor onClose={() => setHouseholdOpen(false)} /> : null}
    </>
  );
}
