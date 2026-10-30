import { type ChangeEvent, useRef, useState } from "react";
import { t } from "ttag";

import { Box, Button, Icon, Stack, Text } from "metabase/ui";

import {
  type ImageFormat,
  getImageAcceptAttribute,
  readImageFile,
} from "../../utils/images";

interface ImageUploadButtonProps {
  /** Accessible name of the file input, like "Upload logo". */
  label: string;
  formats: readonly ImageFormat[];
  maxSizeBytes: number;
  disabled?: boolean;
  onUpload: (dataUri: string) => void | Promise<void>;
}

/**
 * A button that lets the admin pick an image file, checks its format and size,
 * and passes it on as a base64 `data:` URI.
 */
export function ImageUploadButton({
  label,
  formats,
  maxSizeBytes,
  disabled,
  onUpload,
}: ImageUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    // reset, so that picking the same file again fires another change
    input.value = "";
    if (!file) {
      return;
    }

    setIsReading(true);
    const result = await readImageFile(file, { formats, maxSizeBytes });
    setIsReading(false);

    if (result.type === "error") {
      setError(result.message);
      return;
    }
    setError(null);
    await onUpload(result.dataUri);
  };

  return (
    <Stack gap="xs" align="flex-start">
      <Box
        component="input"
        ref={inputRef}
        type="file"
        display="none"
        aria-label={label}
        accept={getImageAcceptAttribute(formats)}
        disabled={disabled}
        onChange={handleChange}
      />
      <Button
        leftSection={<Icon name="upload" aria-hidden />}
        loading={isReading}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        {t`Choose a file`}
      </Button>
      {error && (
        <Text c="feedback-negative" size="sm" role="alert">
          {error}
        </Text>
      )}
    </Stack>
  );
}
