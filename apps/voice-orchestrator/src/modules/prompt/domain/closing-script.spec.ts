import { DEFAULT_CLOSING_TEMPLATE, renderClosingTemplate } from "./closing-script";

describe("renderClosingTemplate", () => {
  it("substitutes every named variable", () => {
    const result = renderClosingTemplate(DEFAULT_CLOSING_TEMPLATE, {
      callerName: "Jane",
      problemSummary: "water heater leaking",
      address: "123 Main St",
      priority: "urgent",
      expectedTimeframe: "within the hour",
    });

    expect(result).toBe(
      "Alright Jane, I've got everything down — water heater leaking at " +
        "123 Main St, and I've flagged this as urgent. Our team will reach out " +
        "within the hour. Is there anything else before I let you go?",
    );
  });

  it("leaves an unmatched placeholder untouched rather than throwing", () => {
    const result = renderClosingTemplate("Hello {{name}}, {{unknownVar}}.", { name: "Jane" });

    expect(result).toBe("Hello Jane, {{unknownVar}}.");
  });
});
