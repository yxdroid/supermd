import type { MermaidConfig } from "mermaid";

export const MERMAID_RENDER_CONFIG = {
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "antiscript",
  htmlLabels: true,
  flowchart: {
    htmlLabels: true,
  },
} satisfies MermaidConfig;
