import { describe, expect, it } from "vitest";
import { scrollRatio, scrollTopForRatio } from "./scrollSync";

describe("scrollSync", () => {
  it("calculates a clamped scroll ratio", () => {
    expect(scrollRatio({ scrollTop: 50, scrollHeight: 300, clientHeight: 100 })).toBe(0.25);
    expect(scrollRatio({ scrollTop: -10, scrollHeight: 300, clientHeight: 100 })).toBe(0);
    expect(scrollRatio({ scrollTop: 999, scrollHeight: 300, clientHeight: 100 })).toBe(1);
  });

  it("returns zero ratio for non-scrollable content", () => {
    expect(scrollRatio({ scrollTop: 50, scrollHeight: 100, clientHeight: 100 })).toBe(0);
  });

  it("calculates scrollTop from ratio", () => {
    expect(scrollTopForRatio({ scrollHeight: 300, clientHeight: 100 }, 0.25)).toBe(50);
    expect(scrollTopForRatio({ scrollHeight: 300, clientHeight: 100 }, -1)).toBe(0);
    expect(scrollTopForRatio({ scrollHeight: 300, clientHeight: 100 }, 2)).toBe(200);
  });
});
