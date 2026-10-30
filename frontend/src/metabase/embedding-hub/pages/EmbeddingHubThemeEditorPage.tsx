import { NotFound } from "metabase/common/components/ErrorPages";
import { useHasTokenFeature } from "metabase/common/hooks";
import { EmbeddingThemeEditorApp } from "metabase/embedding/themes/components/ThemeEditor";
import { useSearchParams } from "metabase/router";
import * as Urls from "metabase/urls";

/**
 * The editor is its own route rather than a child of the Appearance page, so it
 * repeats that page's `embedding_simple` gate -- without it a deep link opens
 * the editor on an instance that cannot use it.
 */
export function EmbeddingHubThemeEditorPage() {
  const hasSimpleEmbedding = useHasTokenFeature("embedding_simple");
  const [searchParams] = useSearchParams();

  if (!hasSimpleEmbedding) {
    return <NotFound />;
  }

  // Only the setup guide is honored, so a crafted `return` cannot redirect elsewhere.
  const returnPath =
    searchParams.get("return") === "get-started"
      ? Urls.embeddingHubGetStarted()
      : undefined;

  return (
    <EmbeddingThemeEditorApp
      basePath={Urls.embeddingHubAppearance()}
      returnPath={returnPath}
    />
  );
}
