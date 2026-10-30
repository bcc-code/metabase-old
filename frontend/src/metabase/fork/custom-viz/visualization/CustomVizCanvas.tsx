import { useEffect, useRef, useState } from "react";
import { useLatest } from "react-use";
import { t } from "ttag";

import { Icon, Stack, Text } from "metabase/ui";

import type {
  CustomVizDefinition,
  CustomVizMountHandle,
  CustomVizRenderProps,
} from "../types";

import S from "./CustomVizCanvas.module.css";

type CustomVizCanvasProps = {
  definition: CustomVizDefinition;
  renderProps: CustomVizRenderProps;
};

/** Runs plugin code, returning what it threw, so a plugin can't break the page. */
function runPluginCode(callback: () => void): string | null {
  try {
    callback();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Mounts a plugin into a container element, passes it new props when they
 * change, and unmounts it when the definition changes or the card goes away.
 * Whatever the plugin throws is shown in place of the visualization.
 */
export function CustomVizCanvas({
  definition,
  renderProps,
}: CustomVizCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CustomVizMountHandle | null>(null);
  const renderedPropsRef = useRef<CustomVizRenderProps | null>(null);
  const renderPropsRef = useLatest(renderProps);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const props = renderPropsRef.current;
    setError(
      runPluginCode(() => {
        handleRef.current = definition.mount(container, props);
        renderedPropsRef.current = props;
      }),
    );

    return () => {
      const handle = handleRef.current;
      handleRef.current = null;
      renderedPropsRef.current = null;
      // A plugin that fails to clean up must not break unmounting the card.
      runPluginCode(() => handle?.unmount?.());
      container.replaceChildren();
    };
  }, [definition, renderPropsRef]);

  useEffect(() => {
    const container = containerRef.current;
    const handle = handleRef.current;
    if (!container || !handle || renderedPropsRef.current === renderProps) {
      return;
    }
    renderedPropsRef.current = renderProps;
    setError(
      runPluginCode(() => {
        if (handle.update) {
          handle.update(renderProps);
        } else {
          handle.unmount?.();
          container.replaceChildren();
          handleRef.current = definition.mount(container, renderProps);
        }
      }),
    );
  }, [definition, renderProps]);

  return (
    <div className={S.root}>
      <div
        ref={containerRef}
        className={S.container}
        hidden={error != null}
        data-testid="custom-viz-container"
      />
      {error != null && <CustomVizError message={error} />}
    </div>
  );
}

function CustomVizError({ message }: { message: string }) {
  return (
    <Stack
      align="center"
      justify="center"
      gap="sm"
      h="100%"
      p="md"
      ta="center"
      role="alert"
    >
      <Icon name="warning" c="feedback-negative" />
      <Text fw="bold">{t`This custom visualization ran into a problem.`}</Text>
      <Text c="text-secondary" size="sm">
        {message}
      </Text>
    </Stack>
  );
}
