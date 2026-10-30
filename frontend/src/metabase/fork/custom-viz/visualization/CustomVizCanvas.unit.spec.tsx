import { renderWithProviders, screen } from "__support__/ui";

import type {
  CustomVizDefinition,
  CustomVizMountHandle,
  CustomVizRenderProps,
} from "../types";

import { CustomVizCanvas } from "./CustomVizCanvas";

function createPluginProps(
  opts: Partial<CustomVizRenderProps> = {},
): CustomVizRenderProps {
  return {
    apiVersion: 1,
    data: { cols: [], rows: [] },
    settings: {},
    width: 400,
    height: 300,
    theme: {
      colorScheme: "light",
      fontFamily: "Lato",
      colors: {
        brand: "#509EE3",
        textPrimary: "#4C5773",
        textSecondary: "#696E7B",
        background: "#FFFFFF",
        border: "#EEECEC",
        accents: [],
      },
    },
    isDashboard: false,
    isEditing: false,
    formatValue: (value) => String(value),
    onClick: null,
    ...opts,
  };
}

type MountMock = jest.Mock<
  CustomVizMountHandle,
  [HTMLElement, CustomVizRenderProps]
>;

function createDefinition(handle: CustomVizMountHandle = {}): {
  definition: CustomVizDefinition;
  mount: MountMock;
} {
  const mount: MountMock = jest.fn(
    (container: HTMLElement, props: CustomVizRenderProps) => {
      container.textContent = `${props.width}x${props.height}`;
      return handle;
    },
  );
  return { definition: { mount }, mount };
}

interface SetupOpts {
  definition: CustomVizDefinition;
  pluginProps?: CustomVizRenderProps;
}

function setup({ definition, pluginProps = createPluginProps() }: SetupOpts) {
  const view = renderWithProviders(
    <CustomVizCanvas definition={definition} renderProps={pluginProps} />,
  );
  const rerender = (nextPluginProps: CustomVizRenderProps) =>
    view.rerender(
      <CustomVizCanvas definition={definition} renderProps={nextPluginProps} />,
    );
  return { ...view, rerender };
}

describe("CustomVizCanvas", () => {
  it("mounts the plugin into a container with the render props", () => {
    const { definition, mount } = createDefinition();
    const pluginProps = createPluginProps();

    setup({ definition, pluginProps });

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledWith(
      screen.getByTestId("custom-viz-container"),
      pluginProps,
    );
    expect(screen.getByText("400x300")).toBeInTheDocument();
  });

  it("passes new props to update without mounting again", () => {
    const update = jest.fn();
    const { definition, mount } = createDefinition({ update });
    const { rerender } = setup({ definition });

    const nextPluginProps = createPluginProps({ width: 500 });
    rerender(nextPluginProps);

    expect(mount).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(nextPluginProps);
  });

  it("mounts again with new props when the plugin has no update", () => {
    const unmount = jest.fn();
    const { definition, mount } = createDefinition({ unmount });
    const { rerender } = setup({ definition });

    rerender(createPluginProps({ width: 500 }));

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(2);
    expect(screen.getByText("500x300")).toBeInTheDocument();
  });

  it("unmounts the plugin and empties the container when it goes away", () => {
    const unmount = jest.fn();
    const { definition } = createDefinition({ unmount });
    const { unmount: unmountCanvas } = setup({ definition });
    const container = screen.getByTestId("custom-viz-container");

    unmountCanvas();

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows what the plugin threw while mounting instead of crashing", () => {
    const definition: CustomVizDefinition = {
      mount: () => {
        throw new Error("Herons need at least one row");
      },
    };

    setup({ definition });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This custom visualization ran into a problem.",
    );
    expect(
      screen.getByText("Herons need at least one row"),
    ).toBeInTheDocument();
  });

  it("shows an update error until an update succeeds", () => {
    const update = jest.fn((props: CustomVizRenderProps) => {
      if (props.width === 500) {
        throw new Error("Too wide for herons");
      }
    });
    const { definition } = createDefinition({ update });
    const { rerender } = setup({ definition });

    rerender(createPluginProps({ width: 500 }));
    expect(screen.getByText("Too wide for herons")).toBeInTheDocument();

    rerender(createPluginProps({ width: 600 }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("contains errors the plugin throws while unmounting", () => {
    const { definition } = createDefinition({
      unmount: () => {
        throw new Error("Heron flew away");
      },
    });
    const { unmount } = setup({ definition });

    expect(() => unmount()).not.toThrow();
  });
});
