import { resetApplicationColor, setApplicationColor } from "./colors";

describe("setApplicationColor", () => {
  it("sets an interface color and keeps the others", () => {
    expect(
      setApplicationColor(
        { brand: "#111111", filter: "#222222" },
        "brand",
        "#333333",
      ),
    ).toEqual({ brand: "#333333", filter: "#222222" });
  });

  it("drops the saved variants of a chart color that changes", () => {
    expect(
      setApplicationColor(
        {
          accent6: "#DAE4C2",
          "accent6-light": "#E9EEDC",
          "accent6-dark": "#999999",
          "accent1-light": "#EEEEEE",
        },
        "accent6",
        "#123456",
      ),
    ).toEqual({ accent6: "#123456", "accent1-light": "#EEEEEE" });
  });

  it("does not change the given colors", () => {
    const colors = { brand: "#111111" };
    setApplicationColor(colors, "brand", "#222222");
    expect(colors).toEqual({ brand: "#111111" });
  });
});

describe("resetApplicationColor", () => {
  it("removes a color and the saved variants of a chart color", () => {
    expect(
      resetApplicationColor(
        { brand: "#111111", accent6: "#DAE4C2", "accent6-light": "#E9EEDC" },
        "accent6",
      ),
    ).toEqual({ brand: "#111111" });
    expect(resetApplicationColor({ brand: "#111111" }, "brand")).toEqual({});
  });
});
