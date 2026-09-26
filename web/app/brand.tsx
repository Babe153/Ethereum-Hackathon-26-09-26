export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="19" fill="currentColor" />
      <path
        d="M20 47V18h15a12 12 0 0 1 0 24h-7"
        stroke="#F4F4E9"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m28 29 7 7 13-15"
        stroke="#CAE79B"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProofIllustration({ zh }: { zh: boolean }) {
  return (
    <div
      className="proof-illustration"
      aria-label={
        zh
          ? "托管、验收、付款的流程示意"
          : "Escrow, verification and payment illustration"
      }
    >
      <div className="illustration-grid" aria-hidden="true" />
      <div className="proof-caption">
        <span className="tiny-square" />
        {zh ? "从承诺，到凭证" : "FROM PROMISE TO PROOF"}
      </div>
      <div className="proof-document">
        <div className="proof-doc-head">
          <BrandMark />
          <span>
            PROOF OF WORK
            <br />
            <small>
              {zh ? "交付凭证 · 流程示意" : "DELIVERY RECORD · ILLUSTRATION"}
            </small>
          </span>
          <span className="doc-number">01</span>
        </div>
        <div className="document-lines">
          <i />
          <i />
          <i />
        </div>
        <div className="proof-stamp">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="m8 16 5 5 11-12"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{zh ? "成果有据可查" : "Work, with a record."}</span>
        </div>
      </div>
      <div className="proof-flow">
        {(zh
          ? ["赏金托管", "按标准验收", "依约付款"]
          : ["Escrow", "Verify", "Settle"]
        ).map((name, i) => (
          <div key={name}>
            <b>{String(i + 1).padStart(2, "0")}</b>
            <span>{name}</span>
            {i < 2 && <i aria-hidden="true">→</i>}
          </div>
        ))}
      </div>
    </div>
  );
}
