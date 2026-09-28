import { explainError } from "@/lib/errors";

/** Plain-words error for failed chain reads. When the chain is unreachable we say so; we never pretend. */
export function ErrorBanner({
  title,
  error,
  message,
  onRetry,
}: {
  title?: string;
  error?: unknown;
  message?: string;
  onRetry?: () => void;
}) {
  const text = message ?? (error !== undefined && error !== null ? explainError(error, { read: true }) : "");
  if (!text) return null;
  return (
    <div className="banner banner-bad" role="alert">
      <div>
        {title && <strong>{title}. </strong>}
        {text}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="banner banner-warn" role="status">
      <div>{children}</div>
    </div>
  );
}
