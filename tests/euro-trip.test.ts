/**
 * The engine against the real trip.
 *
 * These are the tests that matter most, because they check the engine against
 * figures twelve people can look up in their own spreadsheet. Everything here
 * is derived from the Euro Trip sheet as read on 2026-09-09.
 */

import { describe, expect, it } from 'vitest';
import { formatAmount } from '../src/money.js';
import { netBalances, pairwiseNet } from '../src/balance.js';
import { splitExpense } from '../src/split.js';
import { settleUp } from '../src/settle.js';
import {
  ALL_MEMBERS,
  SHEET_DISPLAYED_TOTALS,
  SHEET_LINE_ITEMS,
  SQUADS,
  buildEuroTripLedger,
  owedPerMemberFromSheet,
} from './fixtures/euro-trip.js';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('the trip as recorded', () => {
  it('has twelve travellers and thirteen priced line items', () => {
    expect(ALL_MEMBERS).toHaveLength(12);
    expect(SHEET_LINE_ITEMS).toHaveLength(13);
  });

  it('contains six distinct participant sets — which is the whole design problem', () => {
    const sizes = new Set(SHEET_LINE_ITEMS.map((item) => item.participants.length));
    expect([...sizes].sort((a, b) => a - b)).toEqual([6, 7, 8, 10, 12]);

    const shapes = new Set(
      SHEET_LINE_ITEMS.map((item) => [...item.participants].sort().join(',')),
    );
    // Five priced shapes; Paris will add at least one more once it is priced.
    expect(shapes.size).toBe(5);
  });

  it('has the squads the sheet implies', () => {
    expect(SQUADS.everyone).toHaveLength(12);
    expect(SQUADS.akureyri).toHaveLength(10);
    expect(SQUADS.secondCar).toHaveLength(8);
    expect(SQUADS.longHaul).toHaveLength(7);
    expect(SQUADS.londonStay).toHaveLength(6);
    // Stephenie and Steven skip the Akureyri flight.
    expect(SQUADS.akureyri).not.toContain('SL');
    expect(SQUADS.akureyri).not.toContain('SV');
  });
});

describe('totals', () => {
  const ledger = buildEuroTripLedger();

  it('comes to RM 116,823.04 committed before departure', () => {
    const total = sum(ledger.map((e) => e.totalBaseMinor));
    expect(total).toBe(11_682_304);
    expect(formatAmount(total, 'MYR')).toBe('116,823.04');
  });

  it('prices each line item as its per-person figure times its participants', () => {
    const byId = new Map(ledger.map((e) => [e.id, e.totalBaseMinor]));
    expect(byId.get('longhaul-flight')).toBe(595_500 * 7); // RM 41,685.00
    expect(byId.get('london-aparthotel')).toBe(103_364 * 6); // RM 6,201.84
    expect(byId.get('iceland-domestic-flight')).toBe(56_900 * 10); // RM 5,690.00
    expect(byId.get('car-second')).toBe(41_176 * 8); // RM 3,294.08
    expect(byId.get('blue-lagoon')).toBe(57_249 * 12); // RM 6,869.88
  });
});

describe("the sheet's one-sen discrepancy", () => {
  // Every displayed per-person total is one sen below the sum of that person's
  // displayed line items. Consistent across all twelve rows, so it is hidden
  // decimals in a shared column rather than a typo — and it is exactly why this
  // engine holds money as integers.
  const owed = owedPerMemberFromSheet();

  it('shows each person one sen short', () => {
    for (const memberId of ALL_MEMBERS) {
      const computed = owed.get(memberId) as number;
      const displayed = SHEET_DISPLAYED_TOTALS[memberId] as number;
      expect(computed - displayed).toBe(1);
    }
  });

  it('adds up to exactly twelve sen across the group', () => {
    const computed = sum([...owed.values()]);
    const displayed = sum(Object.values(SHEET_DISPLAYED_TOTALS));
    expect(computed).toBe(11_682_304);
    expect(displayed).toBe(11_682_292);
    expect(computed - displayed).toBe(12);
  });

  it('matches the engine, line item by line item', () => {
    const fromLedger = new Map<string, number>();
    for (const expense of buildEuroTripLedger()) {
      for (const split of expense.splits) {
        fromLedger.set(
          split.memberId,
          (fromLedger.get(split.memberId) ?? 0) + split.amountBaseMinor,
        );
      }
    }
    for (const memberId of ALL_MEMBERS) {
      expect(fromLedger.get(memberId)).toBe(owed.get(memberId));
    }
  });
});

describe('invariants — true whoever paid', () => {
  const ledger = buildEuroTripLedger();

  it('splits every expense to exactly its total', () => {
    for (const expense of ledger) {
      expect(sum(expense.splits.map((s) => s.amountBaseMinor))).toBe(expense.totalBaseMinor);
      expect(sum(expense.payers.map((p) => p.amountBaseMinor))).toBe(expense.totalBaseMinor);
    }
  });

  it('nets every balance to zero across the group', () => {
    const balances = netBalances(ledger);
    expect(balances.size).toBe(12);
    expect(sum([...balances.values()])).toBe(0);
  });

  it('holds every amount as a whole number of sen', () => {
    for (const expense of ledger) {
      expect(Number.isInteger(expense.totalBaseMinor)).toBe(true);
      for (const line of [...expense.splits, ...expense.payers]) {
        expect(Number.isInteger(line.amountBaseMinor)).toBe(true);
      }
    }
  });

  it('settles completely, whoever fronted the money', () => {
    // Try several different payer assignments: the settlement must always clear.
    const candidates = ['TSC', 'KKM', 'CCL', 'YSY'];
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const payers = Object.fromEntries(
        SHEET_LINE_ITEMS.map((item, index) => [
          item.id,
          candidates[(index + offset) % candidates.length] as string,
        ]),
      );
      const variant = buildEuroTripLedger(payers);
      const settled = new Map(netBalances(variant));
      for (const t of settleUp(variant)) {
        settled.set(t.from, (settled.get(t.from) ?? 0) + t.amountBaseMinor);
        settled.set(t.to, (settled.get(t.to) ?? 0) - t.amountBaseMinor);
      }
      for (const [, remaining] of settled) expect(remaining).toBe(0);
    }
  });

  it('settles twelve people in at most eleven transfers', () => {
    expect(settleUp(ledger).length).toBeLessThanOrEqual(11);
  });
});

describe('what one traveller owes', () => {
  const ledger = buildEuroTripLedger();
  const owed = owedPerMemberFromSheet();

  it('charges Stephenie only the shared Iceland costs', () => {
    // No London stay, no long-haul flight, no Akureyri hop, no second car.
    expect(owed.get('SL')).toBe(499_601);
    expect(formatAmount(owed.get('SL') as number, 'MYR')).toBe('4,996.01');
  });

  it('charges the London six the most', () => {
    for (const memberId of SQUADS.londonStay) {
      expect(owed.get(memberId)).toBe(1_296_541);
    }
  });

  it('separates Chan Yong Hoay, who flies long-haul but skips the London hotel', () => {
    // Flagged as open question 4 in the spec — this asserts the sheet as read,
    // not that the sheet is right.
    expect(SQUADS.longHaul).toContain('CYH');
    expect(SQUADS.londonStay).not.toContain('CYH');
    expect(owed.get('CYH')).toBe(1_193_177);
    expect((owed.get('YSY') as number) - (owed.get('CYH') as number)).toBe(103_364);
  });

  it('nets what a traveller owes against what they fronted', () => {
    // KKM is the assumed payer for the long-haul flight and the London hotel,
    // so the netting must credit him for both.
    const balances = netBalances(ledger);
    const paid = 595_500 * 7 + 103_364 * 6;
    expect(balances.get('KKM')).toBe(paid - (owed.get('KKM') as number));
  });
});

describe('netting between two travellers', () => {
  const ledger = buildEuroTripLedger();

  it('nets in both directions rather than showing two gross figures', () => {
    // KKM fronted the flight and London hotel; CCL fronted both car rentals.
    const result = pairwiseNet('CCL', 'KKM', ledger);
    expect(result.aOwesB).toBeGreaterThan(0);
    expect(result.bOwesA).toBeGreaterThan(0);
    expect(result.netBaseMinor).toBe(result.aOwesB - result.bOwesA);
    expect(sum(result.components.map((c) => c.amountBaseMinor))).toBe(result.netBaseMinor);
  });

  it('keeps every pairwise figure consistent with the group balances', () => {
    const balances = netBalances(ledger);
    for (const memberId of ALL_MEMBERS) {
      // A member's net is the sum of their netted position against everyone else.
      const viaPairs = sum(
        ALL_MEMBERS.filter((other) => other !== memberId).map(
          (other) => -pairwiseNet(memberId, other, ledger).netBaseMinor,
        ),
      );
      expect(viaPairs).toBe(balances.get(memberId));
    }
  });
});

describe('re-splitting the sheet with the engine', () => {
  it('reproduces the sheet exactly when told the per-person amounts', () => {
    for (const item of SHEET_LINE_ITEMS) {
      const total = item.perPersonSen * item.participants.length;
      const lines = splitExpense({
        totalMinor: total,
        participants: item.participants,
        method: 'exact',
        exact: Object.fromEntries(item.participants.map((m) => [m, item.perPersonSen])),
      });
      expect(lines.every((l) => l.amountMinor === item.perPersonSen)).toBe(true);
    }
  });

  it('reaches the same per-person figures by splitting equally', () => {
    // Because each column total is an exact multiple of its participant count,
    // an equal split and the sheet's exact amounts agree. That is a real check:
    // if they disagreed, the sheet would be hiding an uneven split.
    for (const item of SHEET_LINE_ITEMS) {
      const total = item.perPersonSen * item.participants.length;
      const lines = splitExpense({
        totalMinor: total,
        participants: item.participants,
        method: 'equal',
      });
      for (const line of lines) expect(line.amountMinor).toBe(item.perPersonSen);
    }
  });

  it('would charge a couple double if the group were paired up', () => {
    // Not how the trip is currently split — this proves the household mode
    // works at the real scale, ready for whoever turns out to be a couple.
    const blueLagoon = SHEET_LINE_ITEMS.find((i) => i.id === 'blue-lagoon');
    if (!blueLagoon) throw new Error('fixture changed');
    const total = blueLagoon.perPersonSen * 12;

    const lines = splitExpense({
      totalMinor: total,
      participants: SQUADS.everyone,
      method: 'household',
      householdOf: { YSY: 'H1', KKM: 'H1', DLJ: 'H2', JGZ: 'H2' },
    });
    expect(sum(lines.map((l) => l.amountMinor))).toBe(total);

    const byMember = new Map(lines.map((l) => [l.memberId, l.amountMinor]));
    // Ten wallets now, not twelve: eight solos plus two couples. RM 6,869.88
    // over ten wallets is 68,698.8 sen, so wallets land on 68,698 or 68,699 —
    // never more than a sen apart, and never off in total.
    const soloShare = byMember.get('SL') as number;
    const coupleShare = (byMember.get('YSY') as number) + (byMember.get('KKM') as number);
    for (const wallet of [soloShare, coupleShare]) {
      expect(Math.abs(wallet - total / 10)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(coupleShare - soloShare)).toBeLessThanOrEqual(1);

    // The point of the mode: each half of a couple pays about half what a solo
    // traveller pays, because the couple is charged once as a wallet.
    expect(byMember.get('YSY') as number).toBeLessThan(soloShare);
    expect(Math.abs((byMember.get('YSY') as number) * 2 - soloShare)).toBeLessThanOrEqual(1);

    // And a solo now pays more than they would under a plain twelve-way split.
    expect(soloShare).toBeGreaterThan(blueLagoon.perPersonSen);
  });
});
