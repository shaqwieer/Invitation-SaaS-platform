import { Fragment } from 'react';

/**
 * Renders an operator-authored policy.
 *
 * The body is plain text with three pieces of structure — a blank line separates
 * paragraphs, `## ` opens a section, `- ` is a list item — parsed into React
 * elements here.
 *
 * Not `dangerouslySetInnerHTML`, and not a Markdown library. This text is typed
 * into the admin panel and rendered on a public page, so HTML in it would be
 * stored XSS by design; producing elements instead means the worst an admin can
 * do to a visitor is write a bad paragraph. It is also the whole reason `apps/web`
 * still has no Markdown dependency: three block types do not need a parser.
 *
 * Anything the format does not recognise falls through as a paragraph rather
 * than being dropped, so a line beginning with an unexpected character still
 * reaches the reader.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string };

export function parseLegalBody(body: string): Block[] {
  const blocks: Block[] = [];
  // Tolerate CRLF: an operator pasting from Word on Windows is the normal case,
  // and a stray \r would otherwise ride along into every rendered line.
  const lines = body.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: 'list', items: list });
    list = [];
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (!line) {
      flush();
      continue;
    }

    if (line.startsWith('## ')) {
      flush();
      blocks.push({ kind: 'heading', text: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith('- ')) {
      // A list interrupts a paragraph but continues an open list, so bullets
      // written on consecutive lines stay one <ul>.
      flushParagraph();
      list.push(line.slice(2).trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flush();
  return blocks;
}

export function LegalBody({ body }: { body: string }) {
  const blocks = parseLegalBody(body);

  return (
    <div className="flex flex-col gap-5">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {block.kind === 'heading' ? (
            <h2 className="mt-4 text-h3 first:mt-0">{block.text}</h2>
          ) : block.kind === 'list' ? (
            <ul className="flex flex-col gap-2.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-3 text-body leading-loose text-ink-muted">
                  <span aria-hidden className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-emerald-700" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body leading-loose text-ink-muted">{block.text}</p>
          )}
        </Fragment>
      ))}
    </div>
  );
}
