import { describe, expect, test } from "bun:test";
import { isTopDialog, popDialog, pushDialog } from "../src/lib/dialogStack";

describe("dialogStack", () => {
  test("a freshly opened dialog is on top", () => {
    const a = pushDialog();
    expect(isTopDialog(a)).toBe(true);
    popDialog(a);
    expect(isTopDialog(a)).toBe(false);
  });

  test("the last-opened dialog wins; popping restores the one below", () => {
    const a = pushDialog();
    const b = pushDialog();
    expect(isTopDialog(b)).toBe(true);
    expect(isTopDialog(a)).toBe(false);
    popDialog(b);
    expect(isTopDialog(a)).toBe(true);
    popDialog(a);
  });

  test("unknown ids and double pops are no-ops", () => {
    const a = pushDialog();
    popDialog(999999);
    popDialog(a);
    popDialog(a); // second pop: already gone
    expect(isTopDialog(a)).toBe(false);
  });
});
