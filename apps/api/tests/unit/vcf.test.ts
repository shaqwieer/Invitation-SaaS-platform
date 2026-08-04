import { describe, expect, it } from 'vitest';
import { detectColumnMapping } from '@da3wa/shared';
import { parseGuestFile } from '../../src/modules/guests/import.parser.js';

/**
 * The shapes real phones export.
 *
 * Every fixture here is a quirk that was found in an actual contacts file, not
 * a variation invented for coverage: iOS's `item1.` groups, Android 2.1's
 * quoted-printable Arabic, CRLF line endings, and contacts carrying three
 * numbers of which only one can receive an invitation.
 */

/** vCards are CRLF-terminated. Written explicitly so the fixture cannot drift. */
const crlf = (...lines: string[]) => Buffer.from(lines.join('\r\n'), 'utf8');

describe('parseGuestFile — .vcf', () => {
  it('reads an iOS export, groups and all', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:العتيبي;محمد;;;',
        'FN:محمد العتيبي',
        'item1.TEL;type=CELL;type=VOICE;type=pref:+966 50 123 4567',
        'item1.X-ABLabel:iPhone',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    expect(sheet.headers).toEqual(['الاسم', 'رقم الجوال']);
    expect(sheet.rows[0]!.cells).toEqual(['محمد العتيبي', '+966 50 123 4567']);
  });

  it('decodes the quoted-printable Arabic an Android 2.1 export writes', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:2.1',
        'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=D9=81=D8=A7=D8=B7=D9=85=D8=A9;;;',
        'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D9=81=D8=A7=D8=B7=D9=85=D8=A9',
        'TEL;CELL:0501112222',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells).toEqual(['فاطمة', '0501112222']);
  });

  it('follows a quoted-printable soft line break', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:2.1',
        'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D8=B9=D8=A8=D8=AF=D8=A7=D9=84=D9=84=D9=87=',
        '=20=D8=A7=D9=84=D8=B4=D9=87=D8=B1=D9=8A',
        'TEL;CELL:0503334444',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells).toEqual(['عبدالله الشهري', '0503334444']);
  });

  it('follows a folded line', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        // Folding breaks a value at an arbitrary point and marks the
        // continuation with a leading space. Rejoining must not put a space
        // back — the one in the name below is on the first line, where the
        // folder left it.
        'FN:Abdulrahman Al-',
        ' Qahtani',
        'TEL;TYPE=CELL:0505556666',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells).toEqual(['Abdulrahman Al-Qahtani', '0505556666']);
  });

  it('prefers the mobile when a contact carries several numbers', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:سارة القحطاني',
        'TEL;TYPE=HOME:011 234 5678',
        'TEL;TYPE=WORK:011 999 8888',
        'TEL;TYPE=CELL:0507778888',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells).toEqual(['سارة القحطاني', '0507778888']);
  });

  it('falls back to a landline when that is all the contact has', async () => {
    const sheet = await parseGuestFile(
      crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:مكتب', 'TEL:011 234 5678', 'END:VCARD', ''),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells).toEqual(['مكتب', '011 234 5678']);
  });

  it('builds a name out of N when FN is missing', async () => {
    const sheet = await parseGuestFile(
      crlf('BEGIN:VCARD', 'VERSION:3.0', 'N:الغامدي;نورة;;;', 'TEL;TYPE=CELL:0509990000', 'END:VCARD', ''),
      'contacts.vcf',
    );

    // First then last — not the file's own order, which puts the surname first.
    expect(sheet.rows[0]!.cells).toEqual(['نورة الغامدي', '0509990000']);
  });

  it('carries a contact with no number through to the errors screen', async () => {
    const sheet = await parseGuestFile(
      crlf(
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:بدون رقم',
        'END:VCARD',
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:له رقم',
        'TEL;TYPE=CELL:0501234567',
        'END:VCARD',
        '',
      ),
      'contacts.vcf',
    );

    // Both rows land. The design's rule is that a problem row comes back listed
    // with what is wrong, which it cannot do if the parser drops it here.
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]!.cells).toEqual(['بدون رقم', null]);
  });

  it('leaves no trailing carriage return on a value', async () => {
    const sheet = await parseGuestFile(
      crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:خالد', 'TEL;TYPE=CELL:0501234567', 'END:VCARD', ''),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells[1]).toBe('0501234567');
  });

  it('reads every card in a multi-contact file', async () => {
    const cards = Array.from({ length: 3 }, (_, i) =>
      ['BEGIN:VCARD', 'VERSION:3.0', `FN:ضيف ${i}`, `TEL;TYPE=CELL:05000000${i}${i}`, 'END:VCARD'].join(
        '\r\n',
      ),
    );

    const sheet = await parseGuestFile(Buffer.from(cards.join('\r\n'), 'utf8'), 'contacts.vcf');

    expect(sheet.rows).toHaveLength(3);
    expect(sheet.totalRows).toBe(3);
  });

  it('unescapes a comma inside a name', async () => {
    const sheet = await parseGuestFile(
      crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:Al-Harbi\\, Omar', 'TEL;TYPE=CELL:0501234567', 'END:VCARD', ''),
      'contacts.vcf',
    );

    expect(sheet.rows[0]!.cells[0]).toBe('Al-Harbi, Omar');
  });

  it('rejects a file with no contacts in it', async () => {
    await expect(parseGuestFile(Buffer.from('BEGIN:VCARD\r\nEND:VCARD\r\n'), 'x.vcf')).rejects.toThrow(
      /no readable contacts/,
    );
  });

  it('hands the mapper headers it matches without review', async () => {
    const sheet = await parseGuestFile(
      crlf('BEGIN:VCARD', 'VERSION:3.0', 'FN:محمد', 'TEL;TYPE=CELL:0501234567', 'END:VCARD', ''),
      'contacts.vcf',
    );

    // The whole reason the synthesized headers are Arabic: the host should not
    // have to map columns for a file they never built.
    const { columns, confidence } = detectColumnMapping(sheet.headers);
    expect(columns.name).toBe(0);
    expect(columns.phone).toBe(1);
    expect(confidence.name).toBe('auto');
    expect(confidence.phone).toBe('auto');
  });
});
