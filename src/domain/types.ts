/**
 * The domain, as the spec's section 3 defines it.
 *
 * These types are the contract between storage and the UI. They deliberately
 * mirror the Postgres schema in db/schema.sql one-for-one, so the local store
 * and the eventual server hold the same shapes and sync is a transport concern
 * rather than a translation one.
 *
 * Every amount is an integer in minor units. Fields named `...Minor` are in the
 * expense's own currency; `...BaseMinor` are in the trip's base currency,
 * converted once at a rate frozen when the expense was saved.
 */

export type Id = string;

export type SplitMethodName = 'equal' | 'shares' | 'percent' | 'exact' | 'household';

export type ExpenseCategory =
  | 'accommodation'
  | 'transport'
  | 'fuel'
  | 'food'
  | 'groceries'
  | 'activity'
  | 'shopping'
  | 'fees'
  | 'other';

export const CATEGORIES: readonly { id: ExpenseCategory; label: string; icon: string }[] = [
  { id: 'accommodation', label: 'Stay', icon: '🏨' },
  { id: 'transport', label: 'Transport', icon: '🚗' },
  { id: 'fuel', label: 'Fuel', icon: '⛽' },
  { id: 'food', label: 'Food', icon: '🍽' },
  { id: 'groceries', label: 'Groceries', icon: '🛒' },
  { id: 'activity', label: 'Activity', icon: '🎟' },
  { id: 'shopping', label: 'Shopping', icon: '🛍' },
  { id: 'fees', label: 'Fees', icon: '💳' },
  { id: 'other', label: 'Other', icon: '📌' },
];

export type TransferMethod = 'bank' | 'cash' | 'tng' | 'other';

/** A person, persisting across trips. Joel is the same Joel next year. */
export interface Person {
  id: Id;
  displayName: string;
  /** Index into the avatar palette, so a person keeps their colour everywhere. */
  colorIndex: number;
  createdAt: string;
}

export interface Trip {
  id: Id;
  name: string;
  baseCurrency: string;
  startsOn: string;
  endsOn: string;
  createdBy: Id;
  createdAt: string;
  /** Secret in the invite link. Server-side this gates joining; see db/schema.sql. */
  inviteToken: string;
}

/**
 * A person's participation in one trip.
 *
 * There is no role column: every member is an admin (GRP-02). The only
 * asymmetry is `Trip.createdBy`, who cannot be removed, so a trip can never be
 * orphaned.
 */
export interface Member {
  id: Id;
  tripId: Id;
  personId: Id;
  householdId?: Id;
  joinedAt: string;
}

/** Two or more members sharing one wallet — a couple. */
export interface Household {
  id: Id;
  tripId: Id;
  name: string;
  /** Which member receives the household's settle-up payment. */
  settleToMemberId: Id;
}

/** A leg of the trip. Supplies the default currency and drives filtering. */
export interface Segment {
  id: Id;
  tripId: Id;
  name: string;
  startsOn: string;
  endsOn: string;
  defaultCurrency: string;
  sortOrder: number;
}

/** A named, saved participant subset. The object that makes this app worth building. */
export interface Squad {
  id: Id;
  tripId: Id;
  name: string;
  memberIds: Id[];
  sortOrder: number;
}

export interface ExpensePayer {
  memberId: Id;
  amountMinor: number;
  amountBaseMinor: number;
}

export interface ExpenseSplit {
  memberId: Id;
  /** The weight that produced this line, kept so the editor can reopen as it was. */
  weight: number;
  amountMinor: number;
  amountBaseMinor: number;
}

export interface Expense {
  id: Id;
  tripId: Id;
  segmentId?: Id;
  description: string;
  category: ExpenseCategory;

  amountMinor: number;
  currency: string;
  /** Major-unit rate to the trip's base currency, frozen when this was saved. */
  fxRate: number;
  fxRateDate?: string;
  fxSource?: string;
  amountBaseMinor: number;

  splitMethod: SplitMethodName;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];

  spentAt: string;
  /** Booked before departure, from the planning sheet rather than on the road. */
  isPrepaid: boolean;
  notes?: string;

  createdBy: Id;
  createdAt: string;
  updatedAt: string;
  /** Soft delete: hidden everywhere, never destroyed. Load-bearing now that everyone is an admin. */
  deletedAt?: string;
}

export interface Transfer {
  id: Id;
  tripId: Id;
  fromMemberId: Id;
  toMemberId: Id;
  amountBaseMinor: number;
  method: TransferMethod;
  paidAt: string;
  note?: string;
  createdBy: Id;
  createdAt: string;
  deletedAt?: string;
}

export type AuditAction = 'create' | 'update' | 'delete' | 'restore';

export interface AuditEntry {
  id: Id;
  tripId: Id;
  entity: 'expense' | 'transfer' | 'member' | 'squad' | 'household' | 'trip';
  entityId: Id;
  action: AuditAction;
  actorMemberId?: Id;
  summary: string;
  at: string;
}

/** Which member this device is acting as, per trip. */
export interface DeviceClaim {
  tripId: Id;
  memberId: Id;
  claimedAt: string;
}

export const AVATAR_COLORS = [
  '#B3541E',
  '#2F6F4E',
  '#33608C',
  '#7A4A8C',
  '#A33B52',
  '#1F6F72',
  '#8A6A1F',
  '#4A5A9C',
  '#8C4A2F',
  '#3F7A3F',
  '#7A3F6B',
  '#2E5E7A',
] as const;

export function colorFor(colorIndex: number): string {
  return AVATAR_COLORS[colorIndex % AVATAR_COLORS.length] as string;
}

export function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
  return `${(words[0] as string)[0]}${(words[words.length - 1] as string)[0]}`.toUpperCase();
}
