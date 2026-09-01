/**
 * Where a template's picture actually lives.
 *
 * A preview arrives one of two ways — the operator uploads a file, or pastes a
 * URL for a design that already lives somewhere — and every reader has to
 * collapse the two into one address. The rule was written out twice, in the
 * catalogue and the admin listing, and a third reader (`resolveArtwork`, which
 * decides what a guest sees) simply read the raw column and so treated every
 * uploaded preview as no preview at all. With a gallery that is uploads-only,
 * that silence was the whole difference between a guest seeing the card their
 * host picked and seeing a blank one.
 *
 * Uploaded bytes win: they are the operator's own file, and the pasted URL is
 * the fallback for a design hosted elsewhere.
 */
export interface TemplatePreviewSource {
  id: string;
  previewImageUrl: string | null;
  previewImageMime: string | null;
  previewImageVersion: number;
}

export function templatePreviewUrl(template: TemplatePreviewSource): string | null {
  // Versioned, so replacing the bytes busts every cache holding the old ones —
  // the route behind this URL caches immutably on the strength of it.
  if (template.previewImageMime) {
    return `/api/templates/${template.id}/preview?v=${template.previewImageVersion}`;
  }
  return template.previewImageUrl;
}
