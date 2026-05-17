import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { MERMAID_RENDER_CONFIG } from "./diagramConfig";

describe("MERMAID_RENDER_CONFIG", () => {
  it("allows Mermaid flowchart labels with html line breaks while blocking scripts", () => {
    expect(MERMAID_RENDER_CONFIG.htmlLabels).toBe(true);
    expect(MERMAID_RENDER_CONFIG.flowchart?.htmlLabels).toBe(true);
    expect(MERMAID_RENDER_CONFIG.securityLevel).toBe("antiscript");
  });

  it("parses architecture flowcharts with quoted database labels and html line breaks", async () => {
    mermaid.initialize(MERMAID_RENDER_CONFIG);

    const parseResult = await mermaid.parse([
      "flowchart LR",
      '  FE["前端应用<br/>基于 epaas 前端组件"] --> GW["epaas gateway<br/>统一网关"]',
      '  GW --> BFF["BFF<br/>页面聚合与接口适配"]',
      '  BFF --> SVC["fullstack-demo-service<br/>epaas 框架 EAPR"]',
      '  SVC --> DB[("DB<br/>相对方主数据")]',
      '  SVC --> Redis[("Redis<br/>缓存 / 防重复提交 / 临时状态")]',
    ].join("\n"));

    expect(parseResult).toMatchObject({ diagramType: "flowchart-v2" });
  });
});
