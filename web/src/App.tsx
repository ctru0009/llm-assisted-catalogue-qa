import { useCallback, useEffect, useState } from "react";
import type {
  Decision,
  DecisionResponse,
  ReviewItem,
  ReviewStatus,
  ReviewsResponse,
} from "./types";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(
  /\/$/,
  "",
);

type LoadState = "loading" | "ready" | "error";

type ActionNotice = {
  tone: "success" | "error";
  message: string;
};

function isReviewsResponse(value: unknown): value is ReviewsResponse {
  if (!value || typeof value !== "object") return false;

  const response = value as Partial<ReviewsResponse>;
  return Boolean(
    response.summary &&
      typeof response.summary.PASS === "number" &&
      typeof response.summary.REVIEW === "number" &&
      typeof response.summary.BLOCK === "number" &&
      Array.isArray(response.items),
  );
}

function StatusTag({ status }: { status: ReviewStatus }) {
  return (
    <span className={`status-tag status-${status.toLowerCase()}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

function MetricCard({
  label,
  value,
  status,
  detail,
}: {
  label: string;
  value: number | null;
  status?: ReviewStatus;
  detail: string;
}) {
  return (
    <div className={`metric-card${status ? ` metric-${status.toLowerCase()}` : ""}`}>
      <div className="metric-card__topline">
        <span>{label}</span>
        {status && <StatusTag status={status} />}
      </div>
      <strong className={value === null ? "metric-value metric-value--empty" : "metric-value"}>
        {value === null ? "—" : value}
      </strong>
      <span className="metric-detail">{detail}</span>
    </div>
  );
}

function ReviewCard({
  item,
  deciding,
  onDecision,
}: {
  item: ReviewItem;
  deciding: boolean;
  onDecision: (item: ReviewItem, decision: Decision) => void;
}) {
  const hasSuggestion = Boolean(item.suggestedCategory);
  const titleId = `review-${item.productId}-title`;
  const contextId = `review-${item.productId}-context`;

  return (
    <article className="review-card" aria-labelledby={titleId} aria-busy={deciding}>
      <div className="review-card__header">
        <div>
          <span className="overline">Review item · {item.productId}</span>
          <h3 id={titleId}>{item.title || "Untitled product"}</h3>
        </div>
        <StatusTag status={item.status} />
      </div>

      {hasSuggestion ? (
        <>
          <div className="context-note context-note--category" id={contextId}>
            <span className="context-icon" aria-hidden="true">↗</span>
            <div>
              <span className="overline">Review context</span>
              <strong>Category suggestion required</strong>
              <p>Deterministic checks are recorded. A human must confirm the model’s category suggestion.</p>
            </div>
          </div>
          <dl className="suggestion-details">
            <div className="suggestion-details__category">
              <dt>Suggested category</dt>
              <dd>{item.suggestedCategory}</dd>
            </div>
            {typeof item.confidence === "number" && (
              <div>
                <dt>Confidence</dt>
                <dd className="confidence-value">{Math.round(item.confidence * 100)}%</dd>
              </div>
            )}
            {item.reason && (
              <div className="suggestion-details__reason">
                <dt>Reason</dt>
                <dd>{item.reason}</dd>
              </div>
            )}
          </dl>
        </>
      ) : (
        <div className="context-note context-note--deterministic" id={contextId}>
          <span className="context-icon" aria-hidden="true">!</span>
          <div>
            <span className="overline">Review context</span>
            <strong>Deterministic checks need attention</strong>
            <p>These issues were found by catalogue rules, without model assistance.</p>
          </div>
        </div>
      )}

      {item.issues.length > 0 && (
        <div className="issues-block">
          <h4>Issues found</h4>
          <ul className="issue-list">
            {item.issues.map((issue) => (
              <li key={`${issue.code}-${issue.message}`}>
                <div className="issue-list__meta">
                  <span className="issue-code">{issue.code}</span>
                  <span className="severity">{issue.severity} severity</span>
                </div>
                <p>{issue.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="review-card__footer">
        <p className="decision-hint" id={`${contextId}-hint`}>
          {hasSuggestion
            ? "Approve to apply this exact category, or reject it."
            : "Approve to acknowledge these warnings, or reject the review."}
        </p>
        {deciding && <p className="decision-progress" role="status">Saving your decision…</p>}
        <div className="decision-actions">
          <button
            className="button button--quiet"
            type="button"
            disabled={deciding}
            onClick={() => onDecision(item, "reject")}
            aria-describedby={`${contextId} ${contextId}-hint`}
          >
            Reject
          </button>
          <button
            className="button button--approve"
            type="button"
            disabled={deciding}
            onClick={() => onDecision(item, "approve")}
            aria-describedby={`${contextId} ${contextId}-hint`}
          >
            {deciding ? "Saving…" : hasSuggestion ? "Approve suggestion" : "Approve"}
          </button>
        </div>
      </div>
    </article>
  );
}

function LoadingState() {
  return (
    <section className="state-panel state-panel--loading" role="status" aria-live="polite">
      <span className="loader" aria-hidden="true" />
      <div>
        <h2>Loading review queue</h2>
        <p>Checking the latest catalogue analysis.</p>
      </div>
    </section>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <span className="state-mark" aria-hidden="true">!</span>
      <div>
        <h2>Review queue unavailable</h2>
        <p>{message}</p>
        <button className="button button--dark" type="button" onClick={onRetry}>
          Try again
        </button>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <span className="empty-state__number" aria-hidden="true">00</span>
      <div>
        <h3>Nothing waiting for a decision</h3>
        <p>All analysed products are clear, or their reviews have already been handled.</p>
      </div>
    </section>
  );
}

export function App() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reviews, setReviews] = useState<ReviewsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("The local API did not respond.");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);

  const loadReviews = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage("The local API did not respond.");
    try {
      const response = await fetch(`${API_URL}/reviews`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);

      const payload: unknown = await response.json();
      if (!isReviewsResponse(payload)) throw new Error("The API returned an unexpected response.");

      setReviews(payload);
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(
        error instanceof TypeError
          ? "The local API is not reachable. Start the API, then try again."
          : error instanceof Error
            ? error.message
            : "The local API did not respond.",
      );
    }
  }, []);

  useEffect(() => {
    void loadReviews();
  }, [loadReviews]);

  const handleDecision = async (item: ReviewItem, decision: Decision) => {
    if (decidingId) return;

    setDecidingId(item.productId);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/reviews/${encodeURIComponent(item.productId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });

      if (!response.ok) throw new Error(`Decision could not be saved (${response.status}).`);
      const result = (await response.json().catch(() => null)) as DecisionResponse | null;
      const appliedCategory = result?.appliedCategory || item.suggestedCategory;
      const message =
        decision === "approve"
          ? appliedCategory
            ? `${item.title} approved. Category applied: ${appliedCategory}.`
            : `${item.title} approved. The review has been acknowledged.`
          : `${item.title} rejected and removed from the pending queue.`;

      setReviews((current) =>
        current
          ? { ...current, items: current.items.filter(({ productId }) => productId !== item.productId) }
          : current,
      );
      setNotice({ tone: "success", message });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : "The decision could not be saved.",
      });
    } finally {
      setDecidingId(null);
    }
  };

  const summary = reviews?.summary;
  const pendingCount = reviews?.items.length ?? 0;
  const analysedCount = summary ? summary.PASS + summary.REVIEW + summary.BLOCK : null;

  return (
    <div className="app-shell">
      <div className="topline">
        <span>Catalogue control / Wave 01</span>
        <span className="topline__status"><span className="live-dot" aria-hidden="true" />Human review desk</span>
      </div>

      <header className="hero">
        <div className="hero__copy">
          <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true">✳</span> LLM-assisted catalogue QA</p>
          <h1>Keep the catalogue <em>clear.</em></h1>
          <p className="hero__lede">
            A focused queue for the decisions that deterministic checks and model suggestions cannot make alone.
          </p>
        </div>
        <aside className="hero-note" aria-label="Review principle">
          <span className="overline">Decision boundary</span>
          <strong>Human approval</strong>
          <p>Models interpret. Rules protect. You decide what moves forward.</p>
          <span className="hero-note__stamp">LOCAL REVIEW UI · V1</span>
        </aside>
      </header>

      <main>
        <section className="outcomes-section" aria-labelledby="outcomes-heading">
          <div className="section-heading">
            <div>
              <p className="overline">At a glance</p>
              <h2 id="outcomes-heading">Analysis outcomes</h2>
            </div>
            <p className="analysed-count">
              <span>{analysedCount === null ? "—" : analysedCount}</span> products analysed
            </p>
          </div>
          <div className="metrics-grid">
            <MetricCard label="Passed" value={summary?.PASS ?? null} status="PASS" detail="No action needed" />
            <MetricCard label="Needs review" value={summary?.REVIEW ?? null} status="REVIEW" detail="Human decision required" />
            <MetricCard label="Blocked" value={summary?.BLOCK ?? null} status="BLOCK" detail="Deterministic stop" />
            <MetricCard label="Pending queue" value={reviews ? pendingCount : null} detail="Waiting for a decision" />
          </div>
        </section>

        {notice && (
          <div className={`action-notice action-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">
            <span aria-hidden="true">{notice.tone === "success" ? "✓" : "!"}</span>
            <p>{notice.message}</p>
          </div>
        )}

        <section className="queue-section" aria-labelledby="queue-heading" aria-busy={loadState === "loading"}>
          <div className="section-heading section-heading--queue">
            <div>
              <p className="overline">Human in the loop</p>
              <h2 id="queue-heading">Pending reviews <span className="heading-count">{reviews ? pendingCount : "—"}</span></h2>
            </div>
            {loadState === "ready" && pendingCount > 0 && <p className="queue-note">Oldest first · choose one action per item</p>}
          </div>

          {loadState === "loading" && <LoadingState />}
          {loadState === "error" && <ErrorState message={errorMessage} onRetry={() => void loadReviews()} />}
          {loadState === "ready" && reviews && (
            reviews.items.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="review-list">
                {reviews.items.map((item) => (
                  <ReviewCard
                    key={item.productId}
                    item={item}
                    deciding={decidingId === item.productId}
                    onDecision={handleDecision}
                  />
                ))}
              </div>
            )
          )}
        </section>
      </main>

      <footer className="footer">
        <span>Deterministic software acts. LLMs interpret.</span>
        <span>API · {API_URL}</span>
      </footer>
    </div>
  );
}
