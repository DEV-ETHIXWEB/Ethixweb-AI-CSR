import {
  addressCheckKey,
  checkAddress,
  describeAddressCheck,
  extractStreet,
  loadStreetIndex,
} from "./address-check";
import { streetCoreName } from "./street-name";

describe("streetCoreName", () => {
  it.each([
    ["NE 45th St", "45th"],
    ["Northeast Forty Fifth Street", "45th"],
    ["5th Ave S", "5th"],
    ["Fifth Avenue", "5th"],
    ["Martin Luther King Jr Way S", "martin luther king jr"],
    ["Saint Andrews Dr", "st andrews"],
    ["Zorblax Boulevard", "zorblax"],
    ["Loop", "loop"],
  ])("%s -> %s", (raw, expected) => {
    expect(streetCoreName(raw)).toBe(expected);
  });
});

describe("extractStreet", () => {
  it("reads a plain address", () => {
    expect(extractStreet("it's 4471 Zorblax Boulevard, Seattle")?.core).toBe("zorblax");
  });

  it("reads spoken digits, a spoken ordinal and a written one", () => {
    expect(extractStreet("one three zero zero five se twenty fifth street")?.core).toBe("25th");
    expect(extractStreet("13005 SE 245th Street, Kent")?.core).toBe("245th");
  });

  it("needs a house number, so a loose phrase is not an address", () => {
    expect(extractStreet("it's on 5th Avenue")).toBeNull();
    expect(extractStreet("my phone is 555 010 2233")).toBeNull();
  });

  it("takes the most recent address when the caller corrects themselves", () => {
    expect(extractStreet("4471 Oak Street, no sorry 4471 Pine Street")?.core).toBe("pine");
  });
});

describe("checkAddress against the bundled Census index", () => {
  const index = loadStreetIndex();

  it("loads the index", () => {
    expect(index).not.toBeNull();
  });

  it("finds a real street in its ZIP", () => {
    expect(checkAddress("1200 Pine Street", "98101", index!)?.kind).toBe("found");
  });

  it("flags an invented street with a real ZIP (client feedback: Zorblax Boulevard 98101)", () => {
    const check = checkAddress("4471 Zorblax Boulevard", "98101", index!);
    expect(check?.kind).toBe("not_found");
    expect(describeAddressCheck(check!)).toContain("not found in our records");
    expect(describeAddressCheck(check!)).toContain("Never say the address is invalid");
  });

  it("flags a real street given with the wrong ZIP", () => {
    expect(checkAddress("1200 Pine Street", "98402", index!)?.kind).toBe("wrong_zip");
  });

  it("offers a close match for a one-letter mishearing", () => {
    const check = checkAddress("1200 Pinee Street", "98101", index!);
    expect(check?.kind).toBe("close");
  });

  it("says nothing when the ZIP is outside the index, and nothing for a found street", () => {
    expect(checkAddress("12 Pine Street", "10001", index!)).toBeNull();
    expect(describeAddressCheck(checkAddress("1200 Pine Street", "98101", index!)!)).toBeNull();
  });

  it("without a ZIP, still catches a street that exists nowhere in the area", () => {
    expect(checkAddress("4471 Zorblax Boulevard", null, index!)?.kind).toBe("not_found");
    expect(checkAddress("1200 Pine Street", null, index!)?.kind).toBe("found");
  });

  it("keys a verdict so an unchanged one is not announced twice", () => {
    const a = checkAddress("4471 Zorblax Boulevard", "98101", index!);
    const b = checkAddress("my address is 4471 zorblax boulevard", "98101", index!);
    expect(addressCheckKey(a)).toBe(addressCheckKey(b));
    expect(addressCheckKey(null)).toBe("");
  });
});
