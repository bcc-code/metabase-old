import { useCallback, useMemo } from "react";
import { useLatest } from "react-use";

import { getCustomPluginIdentifier } from "metabase/visualizations/custom-visualizations/custom-viz-utils";
import { useBrowserRenderingContext } from "metabase/visualizations/hooks/use-browser-rendering-context";
import type {
  Visualization,
  VisualizationProps,
} from "metabase/visualizations/types";
import {
  type VisualizationDefinition,
  getDefaultSize,
  getMinSize,
} from "metabase/viz-core";
import type { CustomVizDisplayType } from "metabase-types/api";

import {
  CUSTOM_VIZ_API_VERSION,
  type CustomVizDefinition,
  type CustomVizManifest,
  type CustomVizRenderProps,
  type CustomVizTheme,
} from "../types";

import { CustomVizCanvas } from "./CustomVizCanvas";
import { getDataRequirementsProblem } from "./data-requirements";
import {
  formatColumnValue,
  getCustomVizClickObject,
  getCustomVizIconName,
  toCustomVizColumn,
} from "./render-props";
import {
  getCustomVizSettingDefinitions,
  getCustomVizSettingValues,
} from "./settings";

const ACCENT_COLOR_NAMES = [
  "accent0",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "accent7",
];

type CustomVisualizationProps = VisualizationProps & {
  display: CustomVizDisplayType;
  manifest: CustomVizManifest;
  definition: CustomVizDefinition;
};

function useCustomVizTheme(
  fontFamily: string,
  isDashboard: boolean,
): CustomVizTheme {
  const renderingContext = useBrowserRenderingContext({
    fontFamily,
    isDashboard,
  });

  return useMemo(() => {
    const { getColor } = renderingContext;
    return {
      colorScheme: renderingContext.colorScheme ?? "light",
      fontFamily: renderingContext.fontFamily,
      colors: {
        brand: getColor("core-brand"),
        textPrimary: getColor("text-primary"),
        textSecondary: getColor("text-secondary"),
        background: getColor("background_page-primary"),
        border: getColor("border-neutral"),
        accents: ACCENT_COLOR_NAMES.map(getColor),
      },
    };
  }, [renderingContext]);
}

function CustomVisualization(props: CustomVisualizationProps) {
  const {
    display,
    manifest,
    definition,
    series,
    settings,
    width,
    height,
    fontFamily,
    isDashboard,
    isEditing,
    onVisualizationClick,
  } = props;
  const [{ data }] = series;
  const latestPropsRef = useLatest(props);
  const theme = useCustomVizTheme(fontFamily, Boolean(isDashboard));

  const handleClick = useCallback(
    (value: unknown) => {
      const latestProps = latestPropsRef.current;
      const clickObject = getCustomVizClickObject(
        latestProps.series,
        latestProps.settings,
        value,
      );
      if (clickObject && latestProps.visualizationIsClickable(clickObject)) {
        latestProps.onVisualizationClick(clickObject);
      }
    },
    [latestPropsRef],
  );

  const isClickable = onVisualizationClick != null;
  const renderProps = useMemo<CustomVizRenderProps>(
    () => ({
      apiVersion: CUSTOM_VIZ_API_VERSION,
      data: {
        cols: data.cols.map(toCustomVizColumn),
        rows: data.rows,
      },
      settings: getCustomVizSettingValues(display, manifest, settings),
      width,
      height,
      theme,
      isDashboard: Boolean(isDashboard),
      isEditing: Boolean(isEditing),
      formatValue: (value, columnName) =>
        formatColumnValue(value, columnName, data.cols, settings),
      onClick: isClickable ? handleClick : null,
    }),
    [
      data,
      display,
      manifest,
      settings,
      width,
      height,
      theme,
      isDashboard,
      isEditing,
      isClickable,
      handleClick,
    ],
  );

  return <CustomVizCanvas definition={definition} renderProps={renderProps} />;
}

type CreateCustomVisualizationOpts = {
  manifest: CustomVizManifest;
  displayName: string;
  icon: string | null;
  definition: CustomVizDefinition;
};

/**
 * A registrable visualization for a plugin: a component that mounts the
 * plugin, carrying the definition statics the registry reads.
 */
export function createCustomVisualization({
  manifest,
  displayName,
  icon,
  definition,
}: CreateCustomVisualizationOpts): Visualization {
  const display = getCustomPluginIdentifier(manifest.identifier);

  function CustomVisualizationComponent(props: VisualizationProps) {
    return (
      <CustomVisualization
        {...props}
        display={display}
        manifest={manifest}
        definition={definition}
      />
    );
  }

  const statics: VisualizationDefinition = {
    identifier: display,
    getUiName: () => displayName,
    iconName: getCustomVizIconName(icon),
    noHeader: false,
    canSavePng: true,
    hidden: false,
    supportsVisualizer: false,
    minSize: getMinSize(display),
    defaultSize: getDefaultSize(display),
    settings: getCustomVizSettingDefinitions(display, manifest),
    checkRenderable: ([{ data }]) => {
      const problem = getDataRequirementsProblem(manifest.data, data);
      if (problem) {
        throw new Error(problem);
      }
    },
  };

  return Object.assign(CustomVisualizationComponent, statics);
}
