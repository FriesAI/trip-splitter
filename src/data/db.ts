/**
 * The local store.
 *
 * IndexedDB is the source of truth for the UI (docs/SPEC.md section 10). Every
 * write lands here first and the screens read from here, so the app works from
 * a cold start with the radio off — which is not a nicety on a trip that spends
 * nine days on the Icelandic ring road.
 *
 * Phase 4 adds a sync queue that drains these same tables to Postgres. Nothing
 * above this file needs to know that happened.
 */

import Dexie, { type Table } from 'dexie';
import type {
  AuditEntry,
  DeviceClaim,
  Expense,
  Household,
  Member,
  Person,
  Segment,
  Squad,
  Transfer,
  Trip,
} from '../domain/types.js';

export class TripSplitterDb extends Dexie {
  people!: Table<Person, string>;
  trips!: Table<Trip, string>;
  members!: Table<Member, string>;
  households!: Table<Household, string>;
  segments!: Table<Segment, string>;
  squads!: Table<Squad, string>;
  expenses!: Table<Expense, string>;
  transfers!: Table<Transfer, string>;
  audit!: Table<AuditEntry, string>;
  claims!: Table<DeviceClaim, string>;

  constructor(name = 'trip-splitter') {
    super(name);
    this.version(1).stores({
      people: 'id, displayName',
      trips: 'id, name, startsOn, inviteToken',
      members: 'id, tripId, personId, householdId, [tripId+personId]',
      households: 'id, tripId',
      segments: 'id, tripId, sortOrder',
      squads: 'id, tripId, sortOrder',
      expenses: 'id, tripId, spentAt, segmentId, category, [tripId+spentAt]',
      transfers: 'id, tripId, paidAt, fromMemberId, toMemberId',
      audit: 'id, tripId, at, [tripId+at]',
      // Keyed by tripId: one claim per trip on this device.
      claims: 'tripId',
    });
  }
}

let instance: TripSplitterDb | undefined;

export function db(): TripSplitterDb {
  instance ??= new TripSplitterDb();
  return instance;
}

/** Point the module at a throwaway database. Tests only. */
export function useTestDb(name: string): TripSplitterDb {
  instance = new TripSplitterDb(name);
  return instance;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Node 18 without webcrypto, and very old browsers. Good enough: ids only
  // need to not collide, and the real uniqueness guarantee is the primary key.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
