import { t } from "ttag";

import { isFunction, isObject } from "metabase-types/guards";

import {
  CUSTOM_VIZ_API_VERSION,
  type CustomVizDefinition,
  type CustomVizHostApi,
  type CustomVizMountHandle,
  type CustomVizRenderProps,
} from "./types";

declare global {
  interface Window {
    MetabaseCustomViz?: CustomVizHostApi;
  }
}

/** The name of the global bundles call, part of the plugin contract. */
// eslint-disable-next-line metabase/no-literal-metabase-strings -- an API name, not the application name
export const HOST_API_GLOBAL_NAME = "MetabaseCustomViz";

type DefineCall =
  | { type: "valid"; definition: CustomVizDefinition }
  | { type: "invalid"; message: string };

const defineCalls = new Map<string, DefineCall>();

function toMountHandle(value: unknown): CustomVizMountHandle {
  if (!isObject(value)) {
    return {};
  }
  const { update, unmount } = value;
  return {
    update: isFunction(update)
      ? (props: CustomVizRenderProps) => {
          update.call(value, props);
        }
      : undefined,
    unmount: isFunction(unmount)
      ? () => {
          unmount.call(value);
        }
      : undefined,
  };
}

function parseDefinition(value: unknown): DefineCall {
  if (!isObject(value) || !isFunction(value.mount)) {
    return {
      type: "invalid",
      message: t`The bundle must pass an object with a mount function to ${HOST_API_GLOBAL_NAME}.define.`,
    };
  }
  const pluginMount = value.mount;
  return {
    type: "valid",
    definition: {
      mount: (container, props) =>
        toMountHandle(pluginMount.call(value, container, props)),
    },
  };
}

function define(identifier: unknown, definition: unknown) {
  if (typeof identifier === "string") {
    defineCalls.set(identifier, parseDefinition(definition));
  }
}

/**
 * Exposes `window.MetabaseCustomViz`, the API bundles call to register their
 * visualization. Safe to call more than once.
 */
export function installCustomVizHostApi() {
  if (window.MetabaseCustomViz) {
    return;
  }
  const hostApi: CustomVizHostApi = Object.freeze({
    apiVersion: CUSTOM_VIZ_API_VERSION,
    define,
  });
  Object.defineProperty(window, HOST_API_GLOBAL_NAME, {
    value: hostApi,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

/**
 * The definition the bundle that just ran registered for `identifier`. Throws
 * when the bundle did not register one, or registered something unusable.
 */
export function takeCustomVizDefinition(
  identifier: string,
): CustomVizDefinition {
  const defineCall = defineCalls.get(identifier);
  defineCalls.delete(identifier);

  if (!defineCall) {
    throw new Error(
      t`The bundle didn't call ${HOST_API_GLOBAL_NAME}.define("${identifier}", …).`,
    );
  }
  if (defineCall.type === "invalid") {
    throw new Error(defineCall.message);
  }
  return defineCall.definition;
}
