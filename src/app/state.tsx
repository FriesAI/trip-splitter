/**
 * App state: one trip snapshot, reloaded after every mutation.
 *
 * Deliberately simple. The whole trip is a few hundred rows, so reading it
 * wholesale and recomputing derived figures is cheap and removes an entire
 * class of bug where a cached balance disagrees with the ledger. When that
 * stops being true, the fix is memoising the derivations, not caching writes.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Id, Member, Person, Trip } from '../domain/types.js';
import { colorFor } from '../domain/types.js';
import { seedIfEmpty } from '../domain/seed.js';
import {
  balancesFor,
  claimMember,
  listTrips,
  loadTrip,
  type TripSnapshot,
} from '../data/repo.js';

const LAST_TRIP_KEY = 'trip-splitter:last-trip';

function readLastTripId(): string | undefined {
  try {
    return window.localStorage.getItem(LAST_TRIP_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastTripId(tripId: string): void {
  try {
    window.localStorage.setItem(LAST_TRIP_KEY, tripId);
  } catch {
    // Private browsing, or site data blocked. Losing the remembered trip is a
    // minor inconvenience, not a failure worth surfacing.
  }
}

export interface MemberView {
  id: Id;
  personId: Id;
  name: string;
  shortName: string;
  color: string;
  householdId?: Id;
}

export interface AppState {
  loading: boolean;
  error?: string;
  trips: Trip[];
  snapshot?: TripSnapshot;
  /** Members resolved to their person, ready to render. */
  memberViews: MemberView[];
  memberById: Map<Id, MemberView>;
  balances: Map<Id, number>;
  /** Which member this device is acting as. */
  me?: MemberView;
  selectTrip: (tripId: Id) => void;
  setMe: (memberId: Id) => Promise<void>;
  refresh: () => Promise<void>;
}

const AppContext = createContext<AppState | undefined>(undefined);

function shortNameOf(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? fullName;
  return first;
}

function viewOf(member: Member, people: Map<Id, Person>): MemberView {
  const person = people.get(member.personId);
  const name = person?.displayName ?? 'Unknown';
  return {
    id: member.id,
    personId: member.personId,
    name,
    shortName: shortNameOf(name),
    color: colorFor(person?.colorIndex ?? 0),
    ...(member.householdId !== undefined ? { householdId: member.householdId } : {}),
  };
}

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState<Id | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<TripSnapshot | undefined>(undefined);

  const load = useCallback(async (wanted?: Id): Promise<void> => {
    try {
      await seedIfEmpty();
      const all = await listTrips();
      setTrips(all);

      const target =
        (wanted && all.some((t) => t.id === wanted) ? wanted : undefined) ??
        (readLastTripId() && all.some((t) => t.id === readLastTripId())
          ? (readLastTripId() as Id)
          : undefined) ??
        all[0]?.id;

      if (!target) {
        setSnapshot(undefined);
        setTripId(undefined);
        return;
      }

      const next = await loadTrip(target);
      setSnapshot(next);
      setTripId(target);
      writeLastTripId(target);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load(tripId);
  }, [load, tripId]);

  const selectTrip = useCallback(
    (next: Id) => {
      setLoading(true);
      void load(next);
    },
    [load],
  );

  const setMe = useCallback(
    async (memberId: Id) => {
      if (!tripId) return;
      await claimMember(tripId, memberId);
      await load(tripId);
    },
    [load, tripId],
  );

  const memberViews = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.members
      .map((member) => viewOf(member, snapshot.people))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot]);

  const memberById = useMemo(
    () => new Map(memberViews.map((view) => [view.id, view])),
    [memberViews],
  );

  const balances = useMemo(() => {
    if (!snapshot) return new Map<Id, number>();
    try {
      return balancesFor(snapshot);
    } catch (cause) {
      // A corrupt ledger must not blank the whole app; the balance screen shows
      // the problem instead.
      setError(cause instanceof Error ? cause.message : String(cause));
      return new Map<Id, number>();
    }
  }, [snapshot]);

  const me = snapshot?.claim ? memberById.get(snapshot.claim.memberId) : undefined;

  const value: AppState = {
    loading,
    ...(error !== undefined ? { error } : {}),
    trips,
    ...(snapshot !== undefined ? { snapshot } : {}),
    memberViews,
    memberById,
    balances,
    ...(me !== undefined ? { me } : {}),
    selectTrip,
    setMe,
    refresh,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
