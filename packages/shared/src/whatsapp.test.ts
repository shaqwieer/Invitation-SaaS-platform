import { describe, expect, it } from 'vitest';
import { buildInviteLink, buildInviteUrl, buildWhatsAppLink, renderMessage } from './whatsapp.js';

describe('renderMessage', () => {
  it('substitutes the guest’s name and link', () => {
    const out = renderMessage('يشرّفنا حضوركم {{name}}… دعوتكم الخاصة:\n{{url}}', {
      name: 'أ. فيصل السبيعي',
      url: 'https://da3wa.sa/invite/f8k2nabc3d4e',
    });

    expect(out).toBe(
      'يشرّفنا حضوركم أ. فيصل السبيعي… دعوتكم الخاصة:\nhttps://da3wa.sa/invite/f8k2nabc3d4e',
    );
  });

  it('tolerates whitespace inside the braces', () => {
    expect(renderMessage('{{ name }}', { name: 'فيصل', url: 'x' })).toBe('فيصل');
  });

  it('leaves an unknown placeholder verbatim', () => {
    // A host who typed {{time}} should see their own text and notice — not send
    // three hundred people the word "undefined".
    const out = renderMessage('الحفل {{time}} — {{name}}', { name: 'فيصل', url: 'x' });
    expect(out).toBe('الحفل {{time}} — فيصل');
    expect(out).not.toContain('undefined');
  });

  it('substitutes every occurrence, not just the first', () => {
    expect(renderMessage('{{name}} و{{name}}', { name: 'أ', url: 'x' })).toBe('أ وأ');
  });

  it('supports the optional event variables', () => {
    const out = renderMessage('{{eventTitle}} · {{eventDate}} · {{venue}}', {
      name: 'x',
      url: 'y',
      eventTitle: 'حفل الزفاف',
      eventDate: 'الجمعة ٢٠ نوفمبر',
      venue: 'قاعة الماسة',
    });
    expect(out).toBe('حفل الزفاف · الجمعة ٢٠ نوفمبر · قاعة الماسة');
  });
});

describe('buildWhatsAppLink', () => {
  it('strips the number down to bare digits', () => {
    // wa.me rejects '+' and spaces — the contact simply fails to resolve.
    const link = buildWhatsAppLink('+966554128830', 'مرحبا');
    expect(link.startsWith('https://wa.me/966554128830?text=')).toBe(true);
  });

  it('percent-encodes Arabic text, newlines and the URL', () => {
    const link = buildWhatsAppLink('+966554128830', 'دعوتك:\nhttps://da3wa.sa/invite/abc?x=1');

    expect(link).not.toContain('\n');
    expect(link).not.toContain(' ');
    // The invite URL's own '?' and '&' must not terminate the text parameter.
    expect(link.split('?text=')[1]).not.toContain('?');

    const decoded = decodeURIComponent(link.split('?text=')[1]!);
    expect(decoded).toBe('دعوتك:\nhttps://da3wa.sa/invite/abc?x=1');
  });
});

describe('buildInviteUrl', () => {
  it('joins base and token', () => {
    expect(buildInviteUrl('https://da3wa.sa', 'f8k2nabc3d4e')).toBe(
      'https://da3wa.sa/invite/f8k2nabc3d4e',
    );
  });

  it('does not double the slash when the base has a trailing one', () => {
    expect(buildInviteUrl('https://da3wa.sa/', 'abc')).toBe('https://da3wa.sa/invite/abc');
    expect(buildInviteUrl('https://da3wa.sa///', 'abc')).toBe('https://da3wa.sa/invite/abc');
  });
});

describe('buildInviteLink', () => {
  it('assembles url, message and deep link together', () => {
    const result = buildInviteLink({
      phone: '+966554128830',
      name: 'أ. فيصل السبيعي',
      token: 'f8k2nabc3d4e',
      template: 'يشرّفنا حضوركم {{name}}:\n{{url}}',
      baseUrl: 'https://da3wa.sa',
    });

    expect(result.url).toBe('https://da3wa.sa/invite/f8k2nabc3d4e');
    expect(result.message).toContain('أ. فيصل السبيعي');
    expect(result.message).toContain(result.url);
    expect(result.whatsappUrl).toContain('wa.me/966554128830');
    expect(decodeURIComponent(result.whatsappUrl)).toContain(result.url);
  });

  it('never leaks the phone number into the invite URL', () => {
    const result = buildInviteLink({
      phone: '+966554128830',
      name: 'فيصل',
      token: 'f8k2nabc3d4e',
      template: '{{url}}',
      baseUrl: 'https://da3wa.sa',
    });

    // The URL must expose no phone number, guest id, or sequential value.
    expect(result.url).not.toContain('966554128830');
    expect(result.url).not.toContain('554128830');
  });
});
