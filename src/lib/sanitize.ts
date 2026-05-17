import DOMPurify from "dompurify";

const PREVIEW_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob|asset):|http:\/\/asset\.localhost\/|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

export function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: PREVIEW_URI_REGEXP,
    ADD_URI_SAFE_ATTR: ["d"],
    ADD_TAGS: ["foreignObject"],
    ADD_ATTR: [
      "d",
      "dominant-baseline",
      "data-mermaid-source-encoded",
      "data-rendered-mermaid-encoded",
    ],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
  });
}
