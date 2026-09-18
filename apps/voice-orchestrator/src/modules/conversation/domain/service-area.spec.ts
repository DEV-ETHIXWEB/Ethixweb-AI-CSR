import {
  classifyZip,
  coveredZipsFromPrompt,
  detectServiceAreaFromTranscript,
} from "./service-area";

// The live knowledge row's shape, abbreviated: a real ZIP list plus the
// headquarters street address, which must NOT be read as a covered ZIP.
const PROMPT = [
  "[BUSINESS OVERRIDE]",
  "Relevant business knowledge:",
  "- [service_area] Cities and counties served: Headquarters: 14101 Interurban Ave S Unit 78-A, Tukwila WA 98168. " +
    "CONFIRMED SERVED ZIP CODES: 98001, 98002, 98011, 98012, 98032, 98033, 98101, 98115, 98168, 98371, 98402, 98446, 98499. Carnation is served.",
  "- [company] Hours: open 24/7, ask about 98999 for fun",
].join("\n");

const covered = coveredZipsFromPrompt(PROMPT);

describe("coveredZipsFromPrompt", () => {
  it("reads the approved ZIP list from the service_area knowledge", () => {
    expect(covered.has("98032")).toBe(true);
    expect(covered.has("98499")).toBe(true);
    expect(covered.size).toBe(13);
  });

  it("never mistakes a street address in that knowledge for a covered ZIP", () => {
    expect(covered.has("14101")).toBe(false);
  });

  it("ignores numbers from OTHER knowledge sections", () => {
    expect(covered.has("98999")).toBe(false);
  });

  it("returns nothing when the business has no service_area knowledge", () => {
    expect(coveredZipsFromPrompt("[PLATFORM BASE]\nno knowledge here").size).toBe(0);
  });
});

describe("classifyZip", () => {
  it.each([
    ["98032", "confirmed"],
    ["98014", "likely"], // Carnation: same 980 prefix as the listed King County ZIPs
    ["98019", "likely"], // Duvall
    ["98201", "outside"], // Everett
    ["99201", "outside"], // Spokane
    ["97201", "outside"], // Portland OR
    ["90210", "outside"],
  ])("%s -> %s", (zip, verdict) => {
    expect(classifyZip(zip, covered)).toBe(verdict);
  });

  it("gives no verdict without an approved list, leaving behaviour unchanged", () => {
    expect(classifyZip("98014", new Set())).toBeNull();
  });
});

describe("detectServiceAreaFromTranscript", () => {
  it("REAL QA FAILURE: Carnation's ZIP is taken, never turned away", () => {
    expect(
      detectServiceAreaFromTranscript(
        "I'm at 98014 out in Carnation, my water heater is leaking.",
        covered,
      ),
    ).toEqual({
      zip: "98014",
      verdict: "likely",
    });
  });

  it("understands a ZIP spoken as words, the way speech recognition delivers it", () => {
    expect(detectServiceAreaFromTranscript("my zip is nine eight zero three two", covered)).toEqual(
      {
        zip: "98032",
        verdict: "confirmed",
      },
    );
  });

  it("REAL CALL b9f8c847: a five-digit HOUSE number is never read as a ZIP", () => {
    expect(
      detectServiceAreaFromTranscript(
        "it's one three zero zero five s e two four five street kent",
        covered,
      ),
    ).toBeNull();
    expect(detectServiceAreaFromTranscript("13005 SE 245th Street, Kent", covered)).toBeNull();
    expect(detectServiceAreaFromTranscript("I live at 12345 Main Street", covered)).toBeNull();
  });

  it("declines a clearly out-of-area ZIP only when the caller actually said 'zip'", () => {
    expect(detectServiceAreaFromTranscript("my zip code is 90210", covered)).toEqual({
      zip: "90210",
      verdict: "outside",
    });
  });

  it("never refuses on a bare number the caller did not call a ZIP", () => {
    expect(detectServiceAreaFromTranscript("the unit is model 90210 I think", covered)).toBeNull();
    expect(detectServiceAreaFromTranscript("account 97201 please", covered)).toBeNull();
  });

  it("still confirms an in-area ZIP even without the word 'zip', since confirming can't lose a customer", () => {
    expect(detectServiceAreaFromTranscript("Water heater's out. I'm at 98402.", covered)).toEqual({
      zip: "98402",
      verdict: "confirmed",
    });
  });

  it("does not treat a 10-digit phone number as a ZIP", () => {
    expect(detectServiceAreaFromTranscript("call me at 2065550123", covered)).toBeNull();
  });

  it("returns nothing when the business has no ZIP list", () => {
    expect(detectServiceAreaFromTranscript("my zip is 98014", new Set())).toBeNull();
  });
});
