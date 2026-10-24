import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { describe, expect, it } from "vitest";
import { checkedLookup, WebToolError } from "../src/network";

/** `checkedLookup` из публичного входа `./network`: договор `lookup` из `node:net`, без сети. */
const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

const lookupOf = (addresses: string[]) => checkedLookup(async () => addresses, false);

interface Answer {
  error: NodeJS.ErrnoException | null;
  address: string | LookupAddress[];
  family?: number;
}

function answerAll(lookup: ReturnType<typeof checkedLookup>): Promise<Answer> {
  return new Promise((resolve) => lookup("site.test", { all: true }, (error, address, family) => resolve({ error, address, family })));
}

function answerOne(lookup: ReturnType<typeof checkedLookup>): Promise<Answer> {
  return new Promise((resolve) => lookup("site.test", { family: 0 }, (error, address, family) => resolve({ error, address, family })));
}

describe("checkedLookup (вход ./network)", () => {
  it("подходит как lookup соединения Node: тот же тип, что у net.connect и tls.connect", () => {
    const lookup: LookupFunction = lookupOf([PUBLIC_V4]);
    expect(typeof lookup).toBe("function");
  });

  it("all: true — все проверенные адреса списком", async () => {
    expect(await answerAll(lookupOf([PUBLIC_V4, PUBLIC_V6]))).toEqual({
      error: null,
      address: [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
      family: undefined,
    });
  });

  it("без all — первый адрес и его семейство", async () => {
    expect(await answerOne(lookupOf([PUBLIC_V6, PUBLIC_V4]))).toEqual({ error: null, address: PUBLIC_V6, family: 6 });
  });

  it("частный адрес среди ответов — отказ `bad_address` в обоих режимах, публичный рядом не спасает", async () => {
    for (const answer of [answerAll, answerOne]) {
      const { error, address } = await answer(lookupOf([PUBLIC_V4, "10.0.0.5"]));
      expect(error).toBeInstanceOf(WebToolError);
      expect((error as WebToolError).kind).toBe("bad_address");
      expect(address).toEqual([]);
    }
  });
});
