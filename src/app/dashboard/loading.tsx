export default function DashboardLoading() {
  return (
    <div className="dashboard-route-loading" role="status" aria-live="polite" aria-label="جارٍ فتح القسم">
      <div className="skeleton dashboard-loading-title" />
      <div className="dashboard-loading-grid">
        <div className="skeleton dashboard-loading-card" />
        <div className="skeleton dashboard-loading-card" />
        <div className="skeleton dashboard-loading-card" />
      </div>
      <span className="sr-only">جارٍ فتح القسم…</span>
    </div>
  );
}
