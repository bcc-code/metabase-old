import { useState } from "react";
import { t } from "ttag";

import { SetByEnvVar } from "metabase/common/components/SetByEnvVar";
import { useSelector } from "metabase/redux";
import { getCustomIllustrationUrl, useAdminSetting } from "metabase/settings";
import { SettingHeader } from "metabase/settings-components";
import { Box, Center, Group, Image, Select, Stack, Text } from "metabase/ui";
import type { IllustrationSettingValue } from "metabase-types/api";

import { ILLUSTRATION_MAX_SIZE_BYTES } from "../../constants";
import type { ImageFormat } from "../../utils/images";
import { ImageUploadButton } from "../ImageUploadButton";

const CUSTOM_ILLUSTRATION_KEYS = {
  "login-page-illustration": "login-page-illustration-custom",
  "landing-page-illustration": "landing-page-illustration-custom",
  "no-data-illustration": "no-data-illustration-custom",
  "no-object-illustration": "no-object-illustration-custom",
} as const;

type IllustrationSettingKey = keyof typeof CUSTOM_ILLUSTRATION_KEYS;

const ILLUSTRATION_FORMATS: readonly ImageFormat[] = [
  "svg",
  "png",
  "jpeg",
  "gif",
  "webp",
];

const isIllustrationSettingValue = (
  value: string | null,
): value is IllustrationSettingValue =>
  value === "default" || value === "none" || value === "custom";

interface IllustrationSettingProps {
  name: IllustrationSettingKey;
  title: string;
  description: string;
  /** The image shown with the "Default" option. */
  defaultSrc: string;
}

/**
 * Picks the default illustration, no illustration, or an uploaded image for
 * one place in the app, like the login page.
 */
export function IllustrationSetting({
  name,
  title,
  description,
  defaultSrc,
}: IllustrationSettingProps) {
  const customName = CUSTOM_ILLUSTRATION_KEYS[name];
  const { value, updateSetting, updateSettingResult, settingDetails } =
    useAdminSetting(name);
  const customUrl = useSelector((state) =>
    getCustomIllustrationUrl(state, customName),
  );
  // "Custom" is only saved once there is an image to show
  const [isCustomPending, setIsCustomPending] = useState(false);
  const option = isCustomPending ? "custom" : (value ?? "default");
  const isSaving = updateSettingResult.isLoading;

  const handleOptionChange = async (nextOption: string | null) => {
    if (!isIllustrationSettingValue(nextOption)) {
      return;
    }
    if (nextOption === "custom" && !customUrl) {
      setIsCustomPending(true);
      return;
    }
    setIsCustomPending(false);
    await updateSetting({ key: name, value: nextOption });
  };

  const handleUpload = async (dataUri: string) => {
    const { error } = await updateSetting({
      key: customName,
      value: dataUri,
      toast: false,
    });
    if (!error) {
      setIsCustomPending(false);
      await updateSetting({ key: name, value: "custom" });
    }
  };

  return (
    <Box data-testid={`${name}-setting`}>
      <SettingHeader id={name} title={title} description={description} />
      {settingDetails?.is_env_setting && settingDetails.env_name ? (
        <SetByEnvVar varName={settingDetails.env_name} />
      ) : (
        <Group gap="lg" align="flex-start">
          <Stack gap="sm">
            <Select
              id={name}
              aria-label={title}
              data={[
                { value: "default", label: t`Default` },
                { value: "none", label: t`No illustration` },
                { value: "custom", label: t`Custom` },
              ]}
              value={option}
              disabled={isSaving}
              onChange={handleOptionChange}
              w="14rem"
            />
            {option === "custom" && (
              <ImageUploadButton
                label={t`Upload an image for ${title}`}
                formats={ILLUSTRATION_FORMATS}
                maxSizeBytes={ILLUSTRATION_MAX_SIZE_BYTES}
                disabled={isSaving}
                onUpload={handleUpload}
              />
            )}
          </Stack>
          <IllustrationPreview
            option={option}
            defaultSrc={defaultSrc}
            customSrc={customUrl}
            title={title}
          />
        </Group>
      )}
    </Box>
  );
}

interface IllustrationPreviewProps {
  option: IllustrationSettingValue;
  defaultSrc: string;
  customSrc: string | undefined;
  title: string;
}

function IllustrationPreview({
  option,
  defaultSrc,
  customSrc,
  title,
}: IllustrationPreviewProps) {
  const src = option === "custom" ? customSrc : defaultSrc;
  const hasImage = option !== "none" && src;

  return (
    <Center
      w="10rem"
      h="6rem"
      p="sm"
      bg="background_page-secondary"
      bd="1px solid border-neutral"
      bdrs="sm"
    >
      {hasImage ? (
        <Image
          src={src}
          alt={t`Preview of the illustration for ${title}`}
          mah="100%"
          maw="100%"
          fit="contain"
        />
      ) : (
        <Text c="text-secondary" size="sm" ta="center">
          {option === "none" ? t`No illustration` : t`No image uploaded yet`}
        </Text>
      )}
    </Center>
  );
}
