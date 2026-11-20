import { describe, expect, test } from "bun:test";
import { dateFromVideoId, newVideoId, vodDate } from "../src/lib/vodDate";

describe("vodDate", () => {
  test("extracts the date from a Twitch download name", () => {
    expect(
      vodDate(
        "twitch_roflgator_2026-11-18 03-01-18_720p_VRChat_I AM BACK GANG LETS CATCH UP WITH EVERYONE AND SEE WHATS GOING ON!.mp4",
      ),
    ).toBe("2026-11-18");
  });

  test("extracts the date from a Kick download name (unicode title)", () => {
    expect(
      vodDate("kick_nariboo_2026-11-08 23-36-07_720p_ASMR_♡ 18+ LIVE #1 ASMR NARITHON ~🐷 !goal !tip !pishock.mp4"),
    ).toBe("2026-11-08");
  });

  test("normalizes a bare YYYYMMDD prefix to dashed form", () => {
    expect(vodDate("20261007_SavoryIcyFalconNerfBlueBlaster-FbruZXw7EhNUY3_Q_source.wav")).toBe(
      "2026-10-07",
    );
  });

  test("the 8-digit form must be a full run, not a window into a longer one", () => {
    expect(vodDate("120261119.mp4")).toBeNull();
    expect(vodDate("202611190.mp4")).toBeNull();
  });

  test("rejects impossible month/day", () => {
    expect(vodDate("2026-13-01.mp4")).toBeNull();
    expect(vodDate("2026-11-32.mp4")).toBeNull();
    expect(vodDate("2026-00-10.mp4")).toBeNull();
  });

  test("the first plausible date in the name wins", () => {
    expect(vodDate("2026-11-19 replay of 2020-05-06.mp4")).toBe("2026-11-19");
  });

  test("names without a date yield null", () => {
    expect(vodDate("01a1c27c-631a-706b-84ea-f5627a471c90.mp4")).toBeNull();
    expect(vodDate("merged.mp4")).toBeNull();
    expect(vodDate("clip24-Markiplier.mp4")).toBeNull();
  });
});

describe("newVideoId / dateFromVideoId", () => {
  const DATED =
    "twitch_sleepylulu_2026-11-19 07-03-30_1080p_VRChat_(•˕ •マⳊ Come Spend Time With Your Favorite Catgirl 3.mp4";

  test("a dated name yields a <date>_<random> id", () => {
    const id = newVideoId(DATED);
    expect(id).toMatch(/^2026-11-19_[0-9a-z]+$/);
    expect(dateFromVideoId(id)).toBe("2026-11-19");
  });

  test("an undated name yields a bare random id", () => {
    const id = newVideoId("merged.mp4");
    expect(id).toMatch(/^[0-9a-z]+$/);
    expect(dateFromVideoId(id)).toBeNull();
  });

  test("the id round-trips the name's date", () => {
    for (const name of [DATED, "20261007_x.wav", "merged.mp4"]) {
      expect(dateFromVideoId(newVideoId(name))).toBe(vodDate(name));
    }
  });

  test("ids are still random", () => {
    expect(newVideoId(DATED)).not.toBe(newVideoId(DATED));
  });

  test("dateFromVideoId rejects ids outside the dated contract", () => {
    expect(dateFromVideoId("abc12345")).toBeNull();
    expect(dateFromVideoId("2026-11-19_a_b")).toBeNull();
    expect(dateFromVideoId("2026-11-19_ab12cd345")).toBeNull(); // 9-char suffix
  });
});
