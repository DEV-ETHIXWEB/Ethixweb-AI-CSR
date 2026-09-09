import {
  DEFAULT_GRACE_PERSONA,
  formatPersonaPrompt,
  type GracePersonaConfig,
} from "./grace-persona";

describe("formatPersonaPrompt", () => {
  it("DEFAULT_GRACE_PERSONA encodes the real call feedback: female presentation, persona age 29, a display name of Grace", () => {
    expect(DEFAULT_GRACE_PERSONA.displayName).toBe("Grace");
    expect(DEFAULT_GRACE_PERSONA.genderPresentation).toBe("female");
    expect(DEFAULT_GRACE_PERSONA.personaAge).toBe(29);
  });

  it("includes the display name unconditionally", () => {
    const text = formatPersonaPrompt(DEFAULT_GRACE_PERSONA);
    expect(text).toContain("Your name is Grace.");
  });

  it("includes gender-presentation guidance when genderPresentation is female — answer plainly, don't over-disclose", () => {
    const text = formatPersonaPrompt(DEFAULT_GRACE_PERSONA);
    expect(text).toContain("presents as female");
    expect(text).toContain("I'm a female AI assistant");
    expect(text).toContain("don't repeat the disclosure again later");
  });

  it("omits gender-presentation guidance entirely when genderPresentation is unspecified", () => {
    const persona: GracePersonaConfig = {
      ...DEFAULT_GRACE_PERSONA,
      genderPresentation: "unspecified",
    };
    const text = formatPersonaPrompt(persona);
    expect(text).not.toContain("presents as");
    expect(text).not.toContain("your gender");
  });

  it("includes persona-age guidance with the configured number when set, and tells the model to answer consistently rather than deflect", () => {
    const text = formatPersonaPrompt(DEFAULT_GRACE_PERSONA);
    expect(text).toContain("around 29");
    expect(text).toContain("rather than deflecting or refusing to answer");
    expect(text).toContain("Always the same number, every time");
  });

  it("omits persona-age guidance entirely when personaAge is null — no fact to answer with", () => {
    const persona: GracePersonaConfig = { ...DEFAULT_GRACE_PERSONA, personaAge: null };
    const text = formatPersonaPrompt(persona);
    expect(text).not.toContain("your age");
    expect(text).not.toContain("around 29");
  });

  it("includes persona-birthday guidance with the configured date when set", () => {
    const text = formatPersonaPrompt(DEFAULT_GRACE_PERSONA);
    expect(text).toContain("March 14th");
  });

  it("omits persona-birthday guidance entirely when personaBirthday is null", () => {
    const persona: GracePersonaConfig = { ...DEFAULT_GRACE_PERSONA, personaBirthday: null };
    const text = formatPersonaPrompt(persona);
    expect(text).not.toContain("your birthday");
  });

  it("folds tone descriptors into a plain, readable list", () => {
    const text = formatPersonaPrompt(DEFAULT_GRACE_PERSONA);
    expect(text).toContain("Tone: warm, emotionally aware, confident");
  });

  it("a fully unconfigured persona (no gender, no age, no birthday) still renders just the name and tone, with no dangling fragments", () => {
    const persona: GracePersonaConfig = {
      displayName: "Assistant",
      genderPresentation: "unspecified",
      personaAge: null,
      personaBirthday: null,
      toneDescriptors: ["helpful"],
    };
    const text = formatPersonaPrompt(persona);
    expect(text).toBe("Your name is Assistant. Tone: helpful.");
  });
});
