import { t } from "ttag";

/**
 * Runs the classic script at `url` by adding a `<script>` element, which the
 * `script-src 'self'` content security policy allows for same-origin URLs.
 * Resolves once it has run; rejects when it fails to download or throws while
 * it runs.
 */
export function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let executionError: string | undefined;

    const handleWindowError = (event: ErrorEvent) => {
      if (event.filename === script.src && executionError === undefined) {
        executionError = event.message;
      }
    };
    const cleanup = () => {
      window.removeEventListener("error", handleWindowError);
      script.remove();
    };

    script.async = true;
    script.src = url;
    script.addEventListener("load", () => {
      cleanup();
      if (executionError === undefined) {
        resolve();
      } else {
        reject(new Error(executionError));
      }
    });
    script.addEventListener("error", () => {
      cleanup();
      reject(new Error(t`The bundle couldn't be downloaded.`));
    });

    window.addEventListener("error", handleWindowError);
    document.head.appendChild(script);
  });
}
