import { describe, expect, it } from 'vitest';
import { renderQrPng, signQrToken, verifyQrToken } from '../../src/lib/qr.js';

const PAYLOAD = {
  eventId: 'cmsaubs5v000bs6mw96ddfi6l',
  invitationId: 'cmsaubs7x001cs6mwabcd1234',
  issuedAt: new Date('2026-11-20T18:06:00.000Z'),
};

describe('signQrToken', () => {
  it('round-trips a payload', () => {
    const result = verifyQrToken(signQrToken(PAYLOAD));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.eventId).toBe(PAYLOAD.eventId);
      expect(result.payload.invitationId).toBe(PAYLOAD.invitationId);
      expect(result.payload.issuedAt.getTime()).toBe(PAYLOAD.issuedAt.getTime());
    }
  });

  it('carries no guest data', () => {
    const token = signQrToken(PAYLOAD);

    // A photographed QR must reveal nothing about who it belongs to.
    for (const secret of ['فيصل', '966554128830', '0554128830', 'السبيعي']) {
      expect(token).not.toContain(secret);
    }
  });

  it('does not embed the invite URL token', () => {
    // The invite token is the credential in /invite/<token>. If it rode inside
    // the QR, photographing a screen at the door would hand over that guest's
    // invitation page.
    const token = signQrToken(PAYLOAD);
    expect(token.split('.')).toHaveLength(5);
    expect(token.split('.')[2]).toBe(PAYLOAD.invitationId);
  });

  it('is deterministic for the same payload', () => {
    expect(signQrToken(PAYLOAD)).toBe(signQrToken(PAYLOAD));
  });

  it('changes when any field changes', () => {
    const base = signQrToken(PAYLOAD);

    expect(signQrToken({ ...PAYLOAD, eventId: 'different-event' })).not.toBe(base);
    expect(signQrToken({ ...PAYLOAD, invitationId: 'different-invite' })).not.toBe(base);
    expect(signQrToken({ ...PAYLOAD, issuedAt: new Date(0) })).not.toBe(base);
  });

  it('stays short enough to scan comfortably', () => {
    // Long payloads push the QR to a higher version with finer modules, which is
    // what makes codes fail to scan off a cracked screen in a dim hall.
    expect(signQrToken(PAYLOAD).length).toBeLessThan(120);
  });
});

describe('verifyQrToken — rejections', () => {
  it('rejects a tampered event id', () => {
    const token = signQrToken(PAYLOAD);
    const parts = token.split('.');
    parts[1] = 'someone-elses-event';

    // Moving a valid code to another wedding must fail on the signature, not
    // merely on a later database check.
    const result = verifyQrToken(parts.join('.'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a tampered invitation id', () => {
    const parts = signQrToken(PAYLOAD).split('.');
    parts[2] = 'cmsaubs7x001cs6mwzzzz9999';

    const result = verifyQrToken(parts.join('.'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a re-dated code', () => {
    const parts = signQrToken(PAYLOAD).split('.');
    parts[3] = Date.now().toString(36);

    const result = verifyQrToken(parts.join('.'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a forged signature', () => {
    const parts = signQrToken(PAYLOAD).split('.');
    parts[4] = 'A'.repeat(32);

    const result = verifyQrToken(parts.join('.'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('rejects a truncated signature without throwing', () => {
    // timingSafeEqual throws on a length mismatch — the length check must come
    // first or this crashes the scanner instead of rejecting the code.
    const parts = signQrToken(PAYLOAD).split('.');
    parts[4] = parts[4]!.slice(0, 10);

    expect(() => verifyQrToken(parts.join('.'))).not.toThrow();
    expect(verifyQrToken(parts.join('.')).ok).toBe(false);
  });

  it('rejects an unknown version', () => {
    const parts = signQrToken(PAYLOAD).split('.');
    parts[0] = '2';

    const result = verifyQrToken(parts.join('.'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('UNSUPPORTED_VERSION');
  });

  it.each([
    ['', 'empty'],
    ['garbage', 'not a token'],
    ['1.a.b', 'too few parts'],
    ['1.a.b.c.d.e', 'too many parts'],
    ['1...c.d', 'blank fields'],
    ['x'.repeat(600), 'absurdly long'],
  ])('rejects %s (%s) as malformed or unsigned', (token) => {
    const result = verifyQrToken(token);
    expect(result.ok).toBe(false);
  });

  it('rejects a token from a scanner reading arbitrary QR codes', () => {
    // Guests do photograph other things; the scanner will feed us anything.
    for (const junk of ['https://example.com', 'WIFI:S:net;P:pw;;', 'BEGIN:VCARD']) {
      expect(verifyQrToken(junk).ok).toBe(false);
    }
  });
});

describe('renderQrPng', () => {
  it('produces a real PNG', async () => {
    const png = await renderQrPng(signQrToken(PAYLOAD));

    expect(png.length).toBeGreaterThan(500);
    // PNG magic number.
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('honours the requested size', async () => {
    const small = await renderQrPng(signQrToken(PAYLOAD), 128);
    const large = await renderQrPng(signQrToken(PAYLOAD), 512);
    expect(large.length).toBeGreaterThan(small.length);
  });
});
