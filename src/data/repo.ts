/**
 * The repository: everything the UI is allowed to do to the data.
 *
 * Two rules are enforced here rather than trusted to callers, because they are
 * the ones that would quietly corrupt a trip:
 *
 *   * an expense is built through `buildExpense`, which runs the engine's
 *     splitter and refuses anything that does not foot to the total;
 *   * a delete is a soft delete, and every mutation writes an audit row —
 *     load-bearing now that every member is an admin and can change anything.
 */

import { convert } from '../money.js';
import { splitExpense, rotationFor, type SplitMethod } from '../split.js';
import {
  type LedgerExpense,
  type Transfer as LedgerTransfer,
  netBalances,
  pairwiseNet,
  type PairwiseNet,
} from '../balance.js';
import { rollUpHouseholds, simplifyBalances, type SettlementTransfer } from '../settle.js';
import { db, newId, nowIso } from './db.js';
import type {
  AuditEntry,
  DeviceClaim,
  Expense,
  ExpenseCategory,
  ExpensePayer,
  ExpenseSplit,
  Household,
  Id,
  Member,
  Person,
  Segment,
  Squad,
  SplitMethodName,
  Transfer,
  TransferMethod,
  Trip,
} from '../domain/types.js';

/** Everything about one trip, loaded together — the shape every screen wants. */
export interface TripSnapshot {
  trip: Trip;
  members: Member[];
  people: Map<Id, Person>;
  households: Household[];
  segments: Segment[];
  squads: Squad[];
  expenses: Expense[];
  transfers: Transfer[];
  claim?: DeviceClaim;
}

export interface ExpenseDraft {
  id?: Id;
  tripId: Id;
  segmentId?: Id;
  description: string;
  category: ExpenseCategory;
  amountMinor: number;
  currency: string;
  fxRate: number;
  fxRateDate?: string;
  fxSource?: string;
  splitMethod: SplitMethodName;
  participantIds: Id[];
  payerIds: Id[];
  /** Payer amounts in the expense currency. Omit for a single payer. */
  payerAmounts?: Record<Id, number>;
  shares?: Record<Id, number>;
  percents?: Record<Id, number>;
  exact?: Record<Id, number>;
  householdOf?: Record<Id, string | undefined>;
  spentAt: string;
  isPrepaid?: boolean;
  notes?: string;
  actorMemberId?: Id;
}

function displayName(people: Map<Id, Person>, members: Member[], memberId: Id): string {
  const member = members.find((m) => m.id === memberId);
  return (member && people.get(member.personId)?.displayName) ?? 'someone';
}

/**
 * Turn a draft into a stored expense, running the engine to produce the splits.
 *
 * The base-currency amount is computed here, once, from the rate the caller
 * froze. Splits are allocated in the expense currency and again in base, so a
 * balance never has to re-derive a conversion and drift from what was shown.
 */
export function buildExpense(draft: ExpenseDraft, baseCurrency: string): Expense {
  const id = draft.id ?? newId();
  const amountBaseMinor = convert(draft.amountMinor, draft.fxRate, draft.currency, baseCurrency);
  const rotation = rotationFor(id);

  const lines = splitExpense({
    totalMinor: draft.amountMinor,
    participants: draft.participantIds,
    method: draft.splitMethod as SplitMethod,
    rotation,
    ...(draft.shares ? { shares: draft.shares } : {}),
    ...(draft.percents ? { percents: draft.percents } : {}),
    ...(draft.exact ? { exact: draft.exact } : {}),
    ...(draft.householdOf ? { householdOf: draft.householdOf } : {}),
  });

  // Allocate the base-currency total across the same weights, so the base
  // amounts foot exactly too rather than being converted line by line and
  // rounding away from the total.
  const baseLines = splitExpense({
    totalMinor: amountBaseMinor,
    participants: draft.participantIds,
    method: draft.splitMethod === 'exact' ? 'shares' : (draft.splitMethod as SplitMethod),
    rotation,
    ...(draft.splitMethod === 'exact'
      ? { shares: Object.fromEntries(lines.map((l) => [l.memberId, l.amountMinor])) }
      : {}),
    ...(draft.shares ? { shares: draft.shares } : {}),
    ...(draft.percents ? { percents: draft.percents } : {}),
    ...(draft.householdOf ? { householdOf: draft.householdOf } : {}),
  });
  const baseByMember = new Map(baseLines.map((l) => [l.memberId, l.amountMinor]));

  const splits: ExpenseSplit[] = lines.map((line) => ({
    memberId: line.memberId,
    weight: line.weight,
    amountMinor: line.amountMinor,
    amountBaseMinor: baseByMember.get(line.memberId) ?? 0,
  }));

  const payerIds = [...new Set(draft.payerIds)];
  if (payerIds.length === 0) throw new Error('an expense needs at least one payer');

  let payers: ExpensePayer[];
  if (payerIds.length === 1) {
    payers = [
      {
        memberId: payerIds[0] as Id,
        amountMinor: draft.amountMinor,
        amountBaseMinor,
      },
    ];
  } else {
    const amounts = draft.payerAmounts ?? {};
    const paid = payerIds.map((memberId) => amounts[memberId] ?? 0);
    const total = paid.reduce((a, b) => a + b, 0);
    if (total !== draft.amountMinor) {
      throw new Error(
        `payers sum to ${total} but the expense is ${draft.amountMinor}`,
      );
    }
    const baseAmounts = splitExpense({
      totalMinor: amountBaseMinor,
      participants: payerIds,
      method: 'shares',
      shares: Object.fromEntries(payerIds.map((memberId, i) => [memberId, paid[i] as number])),
      rotation,
    });
    const baseByPayer = new Map(baseAmounts.map((l) => [l.memberId, l.amountMinor]));
    payers = payerIds.map((memberId, i) => ({
      memberId,
      amountMinor: paid[i] as number,
      amountBaseMinor: baseByPayer.get(memberId) ?? 0,
    }));
  }

  const timestamp = nowIso();
  return {
    id,
    tripId: draft.tripId,
    ...(draft.segmentId !== undefined ? { segmentId: draft.segmentId } : {}),
    description: draft.description.trim() || 'Expense',
    category: draft.category,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    fxRate: draft.fxRate,
    ...(draft.fxRateDate !== undefined ? { fxRateDate: draft.fxRateDate } : {}),
    ...(draft.fxSource !== undefined ? { fxSource: draft.fxSource } : {}),
    amountBaseMinor,
    splitMethod: draft.splitMethod,
    payers,
    splits,
    spentAt: draft.spentAt,
    isPrepaid: draft.isPrepaid ?? false,
    ...(draft.notes !== undefined ? { notes: draft.notes } : {}),
    createdBy: draft.actorMemberId ?? (payerIds[0] as Id),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function writeAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
  await db().audit.add({ ...entry, id: newId(), at: nowIso() });
}

export async function listTrips(): Promise<Trip[]> {
  const trips = await db().trips.toArray();
  return trips.sort((a, b) => b.startsOn.localeCompare(a.startsOn));
}

export async function loadTrip(tripId: Id): Promise<TripSnapshot | undefined> {
  const store = db();
  const trip = await store.trips.get(tripId);
  if (!trip) return undefined;

  const [members, households, segments, squads, allExpenses, allTransfers, claim] =
    await Promise.all([
      store.members.where('tripId').equals(tripId).toArray(),
      store.households.where('tripId').equals(tripId).toArray(),
      store.segments.where('tripId').equals(tripId).toArray(),
      store.squads.where('tripId').equals(tripId).toArray(),
      store.expenses.where('tripId').equals(tripId).toArray(),
      store.transfers.where('tripId').equals(tripId).toArray(),
      store.claims.get(tripId),
    ]);

  const people = new Map<Id, Person>();
  for (const person of await store.people.bulkGet(members.map((m) => m.personId))) {
    if (person) people.set(person.id, person);
  }

  return {
    trip,
    members,
    people,
    households,
    segments: segments.sort((a, b) => a.sortOrder - b.sortOrder),
    squads: squads.sort((a, b) => a.sortOrder - b.sortOrder),
    expenses: allExpenses
      .filter((e) => !e.deletedAt)
      .sort((a, b) => b.spentAt.localeCompare(a.spentAt)),
    transfers: allTransfers
      .filter((t) => !t.deletedAt)
      .sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    ...(claim ? { claim } : {}),
  };
}

export async function saveExpense(
  draft: ExpenseDraft,
  baseCurrency: string,
  snapshot?: Pick<TripSnapshot, 'members' | 'people'>,
): Promise<Expense> {
  const store = db();
  const existing = draft.id ? await store.expenses.get(draft.id) : undefined;
  const expense = buildExpense(draft, baseCurrency);
  if (existing) {
    expense.createdAt = existing.createdAt;
    expense.createdBy = existing.createdBy;
  }
  await store.expenses.put(expense);

  const who = snapshot
    ? displayName(snapshot.people, snapshot.members, expense.payers[0]?.memberId ?? '')
    : 'someone';
  await writeAudit({
    tripId: expense.tripId,
    entity: 'expense',
    entityId: expense.id,
    action: existing ? 'update' : 'create',
    ...(draft.actorMemberId !== undefined ? { actorMemberId: draft.actorMemberId } : {}),
    summary: `${existing ? 'Edited' : 'Added'} "${expense.description}" paid by ${who}`,
  });
  return expense;
}

/** Soft delete. The row stays, so a mistaken tap is always recoverable. */
export async function deleteExpense(expenseId: Id, actorMemberId?: Id): Promise<void> {
  const store = db();
  const expense = await store.expenses.get(expenseId);
  if (!expense) return;
  await store.expenses.update(expenseId, { deletedAt: nowIso() });
  await writeAudit({
    tripId: expense.tripId,
    entity: 'expense',
    entityId: expenseId,
    action: 'delete',
    ...(actorMemberId !== undefined ? { actorMemberId } : {}),
    summary: `Deleted "${expense.description}"`,
  });
}

export async function restoreExpense(expenseId: Id, actorMemberId?: Id): Promise<void> {
  const store = db();
  const expense = await store.expenses.get(expenseId);
  if (!expense) return;
  // Dexie's `update` cannot remove a key, so rewrite the row without it.
  const { deletedAt: _wasDeleted, ...restored } = expense;
  await store.expenses.put(restored);
  await writeAudit({
    tripId: expense.tripId,
    entity: 'expense',
    entityId: expenseId,
    action: 'restore',
    ...(actorMemberId !== undefined ? { actorMemberId } : {}),
    summary: `Restored "${expense.description}"`,
  });
}

export async function recordTransfer(input: {
  tripId: Id;
  fromMemberId: Id;
  toMemberId: Id;
  amountBaseMinor: number;
  method: TransferMethod;
  paidAt?: string;
  note?: string;
  actorMemberId?: Id;
}): Promise<Transfer> {
  if (input.fromMemberId === input.toMemberId) {
    throw new Error('a transfer needs two different people');
  }
  if (input.amountBaseMinor <= 0) throw new Error('a transfer must be for a positive amount');

  const transfer: Transfer = {
    id: newId(),
    tripId: input.tripId,
    fromMemberId: input.fromMemberId,
    toMemberId: input.toMemberId,
    amountBaseMinor: input.amountBaseMinor,
    method: input.method,
    paidAt: input.paidAt ?? nowIso(),
    ...(input.note !== undefined ? { note: input.note } : {}),
    createdBy: input.actorMemberId ?? input.fromMemberId,
    createdAt: nowIso(),
  };
  await db().transfers.add(transfer);
  await writeAudit({
    tripId: input.tripId,
    entity: 'transfer',
    entityId: transfer.id,
    action: 'create',
    ...(input.actorMemberId !== undefined ? { actorMemberId: input.actorMemberId } : {}),
    summary: 'Recorded a settle-up payment',
  });
  return transfer;
}

export async function deleteTransfer(transferId: Id, actorMemberId?: Id): Promise<void> {
  const store = db();
  const transfer = await store.transfers.get(transferId);
  if (!transfer) return;
  await store.transfers.update(transferId, { deletedAt: nowIso() });
  await writeAudit({
    tripId: transfer.tripId,
    entity: 'transfer',
    entityId: transferId,
    action: 'delete',
    ...(actorMemberId !== undefined ? { actorMemberId } : {}),
    summary: 'Removed a settle-up payment',
  });
}

export async function saveSquad(squad: Squad): Promise<void> {
  await db().squads.put(squad);
  await writeAudit({
    tripId: squad.tripId,
    entity: 'squad',
    entityId: squad.id,
    action: 'update',
    summary: `Saved squad "${squad.name}"`,
  });
}

export async function deleteSquad(squadId: Id): Promise<void> {
  const squad = await db().squads.get(squadId);
  if (!squad) return;
  await db().squads.delete(squadId);
  await writeAudit({
    tripId: squad.tripId,
    entity: 'squad',
    entityId: squadId,
    action: 'delete',
    summary: `Deleted squad "${squad.name}"`,
  });
}

export async function saveHousehold(household: Household, memberIds: Id[]): Promise<void> {
  const store = db();
  await store.households.put(household);
  const existing = await store.members.where('tripId').equals(household.tripId).toArray();
  await Promise.all(
    existing.map((member) => {
      const shouldBelong = memberIds.includes(member.id);
      if (shouldBelong && member.householdId !== household.id) {
        return store.members.update(member.id, { householdId: household.id });
      }
      if (!shouldBelong && member.householdId === household.id) {
        const { householdId: _left, ...without } = member;
        return store.members.put(without);
      }
      return Promise.resolve(0);
    }),
  );
  await writeAudit({
    tripId: household.tripId,
    entity: 'household',
    entityId: household.id,
    action: 'update',
    summary: `Saved household "${household.name}"`,
  });
}

export async function deleteHousehold(householdId: Id): Promise<void> {
  const store = db();
  const household = await store.households.get(householdId);
  if (!household) return;
  const members = await store.members.where('householdId').equals(householdId).toArray();
  await Promise.all(
    members.map((m) => {
      const { householdId: _left, ...without } = m;
      return store.members.put(without);
    }),
  );
  await store.households.delete(householdId);
  await writeAudit({
    tripId: household.tripId,
    entity: 'household',
    entityId: householdId,
    action: 'delete',
    summary: `Removed household "${household.name}"`,
  });
}

export async function addMember(tripId: Id, displayNameInput: string): Promise<Member> {
  const store = db();
  const name = displayNameInput.trim();
  if (!name) throw new Error('a member needs a name');

  const count = await store.people.count();
  const person: Person = {
    id: newId(),
    displayName: name,
    colorIndex: count,
    createdAt: nowIso(),
  };
  const member: Member = {
    id: newId(),
    tripId,
    personId: person.id,
    joinedAt: nowIso(),
  };
  await store.people.add(person);
  await store.members.add(member);
  await writeAudit({
    tripId,
    entity: 'member',
    entityId: member.id,
    action: 'create',
    summary: `Added ${name} to the trip`,
  });
  return member;
}

/**
 * Remove a member, but only when nothing depends on them.
 *
 * Refusing is the right behaviour: deleting somebody who appears in expenses
 * would leave splits pointing at nobody, and there is no honest way to
 * reallocate their share without being told how.
 */
export async function removeMember(memberId: Id): Promise<void> {
  const store = db();
  const member = await store.members.get(memberId);
  if (!member) return;

  const trip = await store.trips.get(member.tripId);
  if (trip && trip.createdBy === member.personId) {
    throw new Error('the person who created the trip cannot be removed');
  }

  const expenses = await store.expenses.where('tripId').equals(member.tripId).toArray();
  const involved = expenses.some(
    (e) =>
      !e.deletedAt &&
      (e.payers.some((p) => p.memberId === memberId) ||
        e.splits.some((s) => s.memberId === memberId)),
  );
  if (involved) {
    throw new Error('this person appears in expenses — remove or reassign those first');
  }

  await store.members.delete(memberId);
  await writeAudit({
    tripId: member.tripId,
    entity: 'member',
    entityId: memberId,
    action: 'delete',
    summary: 'Removed a member from the trip',
  });
}

/** Bind this device to a member. The local half of invite-by-link (GRP-01). */
export async function claimMember(tripId: Id, memberId: Id): Promise<void> {
  await db().claims.put({ tripId, memberId, claimedAt: nowIso() });
}

export async function createTrip(input: {
  name: string;
  baseCurrency: string;
  startsOn: string;
  endsOn: string;
  memberNames: string[];
}): Promise<Trip> {
  const store = db();
  const name = input.name.trim();
  if (!name) throw new Error('a trip needs a name');

  const names = input.memberNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('a trip needs at least one member');

  const startingCount = await store.people.count();
  const people: Person[] = names.map((displayNameValue, index) => ({
    id: newId(),
    displayName: displayNameValue,
    colorIndex: startingCount + index,
    createdAt: nowIso(),
  }));

  const trip: Trip = {
    id: newId(),
    name,
    baseCurrency: input.baseCurrency.toUpperCase(),
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    createdBy: (people[0] as Person).id,
    createdAt: nowIso(),
    inviteToken: newId(),
  };

  const members: Member[] = people.map((person) => ({
    id: newId(),
    tripId: trip.id,
    personId: person.id,
    joinedAt: nowIso(),
  }));

  await store.people.bulkAdd(people);
  await store.trips.add(trip);
  await store.members.bulkAdd(members);
  await store.squads.add({
    id: newId(),
    tripId: trip.id,
    name: `Everyone (${members.length})`,
    memberIds: members.map((m) => m.id),
    sortOrder: 0,
  });
  await store.claims.put({
    tripId: trip.id,
    memberId: (members[0] as Member).id,
    claimedAt: nowIso(),
  });
  await writeAudit({
    tripId: trip.id,
    entity: 'trip',
    entityId: trip.id,
    action: 'create',
    summary: `Created "${name}"`,
  });
  return trip;
}

// ------------------------------------------------------------- derivations --
// Thin adapters onto the Phase 1 engine. The UI never reimplements any of this.

export function toLedger(expenses: readonly Expense[]): LedgerExpense[] {
  return expenses.map((expense) => ({
    id: expense.id,
    description: expense.description,
    spentAt: expense.spentAt,
    totalBaseMinor: expense.amountBaseMinor,
    payers: expense.payers.map((p) => ({
      memberId: p.memberId,
      amountBaseMinor: p.amountBaseMinor,
    })),
    splits: expense.splits.map((s) => ({
      memberId: s.memberId,
      amountBaseMinor: s.amountBaseMinor,
    })),
  }));
}

export function toLedgerTransfers(transfers: readonly Transfer[]): LedgerTransfer[] {
  return transfers.map((t) => ({
    id: t.id,
    fromMemberId: t.fromMemberId,
    toMemberId: t.toMemberId,
    amountBaseMinor: t.amountBaseMinor,
    paidAt: t.paidAt,
  }));
}

export function balancesFor(snapshot: TripSnapshot): Map<Id, number> {
  const balances = netBalances(toLedger(snapshot.expenses), toLedgerTransfers(snapshot.transfers));
  // Everyone in the trip appears, even at zero, so the balance sheet is complete.
  for (const member of snapshot.members) {
    if (!balances.has(member.id)) balances.set(member.id, 0);
  }
  return balances;
}

export function pairFor(snapshot: TripSnapshot, a: Id, b: Id): PairwiseNet {
  return pairwiseNet(a, b, toLedger(snapshot.expenses), toLedgerTransfers(snapshot.transfers));
}

export function settlementFor(
  snapshot: TripSnapshot,
  options: { byHousehold?: boolean } = {},
): SettlementTransfer[] {
  const balances = balancesFor(snapshot);
  if (!options.byHousehold) return simplifyBalances(balances);

  const householdOf: Record<Id, string | undefined> = {};
  for (const member of snapshot.members) householdOf[member.id] = member.householdId;
  const settleTo: Record<string, Id> = {};
  for (const household of snapshot.households) {
    settleTo[household.id] = household.settleToMemberId;
  }
  return simplifyBalances(rollUpHouseholds(balances, householdOf, settleTo));
}
