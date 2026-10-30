import type { ReactNode } from "react";

import { SetByEnvVar } from "metabase/common/components/SetByEnvVar";
import { useAdminSetting } from "metabase/settings";
import { SettingHeader } from "metabase/settings-components";
import { Box, Button, Center, Group, Icon } from "metabase/ui";

import type { ImageFormat } from "../../utils/images";
import { ImageUploadButton } from "../ImageUploadButton";

type ImageSettingKey = "application-logo-url" | "application-favicon-url";

interface ImageSettingProps {
  name: ImageSettingKey;
  title: string;
  description: ReactNode;
  /** Accessible name of the file input, like "Upload logo". */
  uploadLabel: string;
  /** Text of the button that restores the default image. */
  resetLabel: string;
  defaultValue: string;
  formats: readonly ImageFormat[];
  maxSizeBytes: number;
  preview: ReactNode;
}

/**
 * An image setting, like the logo, that is uploaded as a `data:` URI and can
 * be reset to the bundled default image.
 */
export function ImageSetting({
  name,
  title,
  description,
  uploadLabel,
  resetLabel,
  defaultValue,
  formats,
  maxSizeBytes,
  preview,
}: ImageSettingProps) {
  const { value, updateSetting, updateSettingResult, settingDetails } =
    useAdminSetting(name);
  const isCustom = value != null && value !== "" && value !== defaultValue;
  const isSaving = updateSettingResult.isLoading;

  return (
    <Box data-testid={`${name}-setting`}>
      <SettingHeader id={name} title={title} description={description} />
      {settingDetails?.is_env_setting && settingDetails.env_name ? (
        <SetByEnvVar varName={settingDetails.env_name} />
      ) : (
        <Group gap="md" align="flex-start">
          <Center
            miw="4rem"
            h="4rem"
            px="md"
            bg="background_page-secondary"
            bd="1px solid border-neutral"
            bdrs="sm"
          >
            {preview}
          </Center>
          <ImageUploadButton
            label={uploadLabel}
            formats={formats}
            maxSizeBytes={maxSizeBytes}
            disabled={isSaving}
            onUpload={async (dataUri) => {
              await updateSetting({ key: name, value: dataUri });
            }}
          />
          {isCustom && (
            <Button
              variant="subtle"
              leftSection={<Icon name="revert" aria-hidden />}
              disabled={isSaving}
              onClick={() => updateSetting({ key: name, value: defaultValue })}
            >
              {resetLabel}
            </Button>
          )}
        </Group>
      )}
    </Box>
  );
}
