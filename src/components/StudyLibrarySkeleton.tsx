import './skeleton.css'

export function StudyLibraryCountSkeleton() {
  return <span className="reviewer-count reviewer-count--loading" aria-label="Loading item count"><span className="cali-skeleton" aria-hidden="true" /></span>
}

export function StudyLibraryFiltersSkeleton() {
  return <div className="reviewer-filters study-library-loading-filters" aria-hidden="true">
    <span className="cali-skeleton" />
    <span className="cali-skeleton" />
  </div>
}

export function StudyLibraryCardsSkeleton({ containerClassName, label }: { containerClassName: 'reviewer-list' | 'study-set-grid'; label: string }) {
  return <div className={`${containerClassName} study-library-loading-cards`} role="status" aria-label={label}>
    {Array.from({ length: 3 }, (_, index) => <div className="study-library-skeleton-card" aria-hidden="true" key={index}>
      <div className="study-library-skeleton-meta"><span className="cali-skeleton" /><span className="cali-skeleton" /></div>
      <span className="cali-skeleton study-library-skeleton-title" />
      <div className="study-library-skeleton-copy"><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--full" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--long" /><span className="cali-skeleton cali-skeleton-line cali-skeleton-line--medium" /></div>
    </div>)}
  </div>
}
