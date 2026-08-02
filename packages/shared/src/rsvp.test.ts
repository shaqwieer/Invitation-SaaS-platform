import { describe, expect, it } from 'vitest';
import { GuestStatus } from './enums.js';
import {
  canRespond,
  checkCompanions,
  seatsFor,
  statusAfterOpen,
  statusForResponse,
} from './rsvp.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

describe('canRespond — the transition matrix', () => {
  it.each([
    GuestStatus.NOT_SENT,
    GuestStatus.SENT,
    GuestStatus.OPENED,
    GuestStatus.CONFIRMED,
    GuestStatus.DECLINED,
  ])('allows a guest in %s to answer', (status) => {
    expect(canRespond({ status, now: NOW }).allowed).toBe(true);
  });

  it('lets a confirmed guest change to declined and back', () => {
    // Both design result screens invite exactly this: «يمكنك تغيير ردّك لاحقًا»
    // and «أستطيع الحضور بعد كل شيء».
    expect(canRespond({ status: GuestStatus.CONFIRMED, now: NOW }).allowed).toBe(true);
    expect(canRespond({ status: GuestStatus.DECLINED, now: NOW }).allowed).toBe(true);
  });

  it('refuses a guest who has already walked through the door', () => {
    const decision = canRespond({ status: GuestStatus.ATTENDED, now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('ALREADY_ATTENDED');
  });

  it('refuses after the deadline', () => {
    const decision = canRespond({
      status: GuestStatus.SENT,
      rsvpDeadline: '2026-11-09T20:59:00.000Z',
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('DEADLINE_PASSED');
  });

  it('allows right up to the deadline', () => {
    const deadline = new Date('2026-11-10T12:00:00.000Z');
    expect(canRespond({ status: GuestStatus.SENT, rsvpDeadline: deadline, now: NOW }).allowed).toBe(
      true,
    );
  });

  it('treats a missing deadline as no deadline', () => {
    for (const deadline of [null, undefined]) {
      expect(
        canRespond({ status: GuestStatus.SENT, rsvpDeadline: deadline, now: NOW }).allowed,
      ).toBe(true);
    }
  });

  it('ignores an unparseable deadline rather than locking everyone out', () => {
    expect(
      canRespond({ status: GuestStatus.SENT, rsvpDeadline: 'not-a-date', now: NOW }).allowed,
    ).toBe(true);
  });

  it('refuses when the event is cancelled', () => {
    const decision = canRespond({ status: GuestStatus.SENT, eventStatus: 'CANCELLED', now: NOW });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('EVENT_NOT_ACTIVE');
  });

  it('checks attendance before the deadline, so the message is the useful one', () => {
    const decision = canRespond({
      status: GuestStatus.ATTENDED,
      rsvpDeadline: '2026-01-01T00:00:00.000Z',
      now: NOW,
    });
    expect(decision.reason).toBe('ALREADY_ATTENDED');
  });

  it('carries a message in both languages', () => {
    const decision = canRespond({ status: GuestStatus.ATTENDED, now: NOW });
    expect(decision.messageAr).toBeTruthy();
    expect(decision.messageEn).toBeTruthy();
  });
});

describe('checkCompanions', () => {
  it('accepts a count within the allowance', () => {
    expect(checkCompanions(3, 3).allowed).toBe(true);
    expect(checkCompanions(0, 3).allowed).toBe(true);
  });

  it('refuses more than the host allowed', () => {
    const decision = checkCompanions(4, 3);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('TOO_MANY_COMPANIONS');
    expect(decision.messageAr).toContain('3');
  });

  it('refuses a negative or fractional count', () => {
    expect(checkCompanions(-1, 3).allowed).toBe(false);
    expect(checkCompanions(1.5, 3).allowed).toBe(false);
  });

  it('refuses any companion when none are allowed', () => {
    expect(checkCompanions(1, 0).allowed).toBe(false);
    expect(checkCompanions(0, 0).allowed).toBe(true);
  });
});

describe('status projection', () => {
  it('maps an answer to a status', () => {
    expect(statusForResponse(true)).toBe(GuestStatus.CONFIRMED);
    expect(statusForResponse(false)).toBe(GuestStatus.DECLINED);
  });

  it('advances only the pre-answer states on open', () => {
    expect(statusAfterOpen(GuestStatus.NOT_SENT)).toBe(GuestStatus.OPENED);
    expect(statusAfterOpen(GuestStatus.SENT)).toBe(GuestStatus.OPENED);
  });

  it('never lets re-reading an invitation erase an answer', () => {
    // A confirmed guest opening their link again is still confirmed.
    for (const status of [GuestStatus.CONFIRMED, GuestStatus.DECLINED, GuestStatus.ATTENDED]) {
      expect(statusAfterOpen(status)).toBe(status);
    }
  });

  it('counts the guest themselves among the seats', () => {
    expect(seatsFor(0)).toBe(1);
    expect(seatsFor(3)).toBe(4);
  });
});
