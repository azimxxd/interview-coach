"use client";

import { useUi } from "@/components/UiProvider";

type MetricsPanelProps = {
  rms: number;
  wpm: number;
  pauseSeconds: number;
  fillerCount: number;
  isCalibrating: boolean;
};

export default function MetricsPanel({
  rms,
  wpm,
  pauseSeconds,
  fillerCount,
  isCalibrating
}: MetricsPanelProps) {
  const { t } = useUi();
  const rmsPct = Math.min(100, Math.round(rms * 120));
  const calibratingLabel = isCalibrating ? t("calibrating") : "";

  return (
    <div className="card stack">
      <h3>{t("liveSignals")}</h3>
      <div className="metrics-grid">
        <div className="metric-card">
          <h4>{t("micLevel")}</h4>
          <p>{rms.toFixed(2)}</p>
          <div className="meter">
            <span style={{ width: `${rmsPct}%` }} />
          </div>
        </div>
        <div className="metric-card">
          <h4>{t("wpm")}</h4>
          <p>{wpm.toFixed(0)}</p>
        </div>
        <div className="metric-card">
          <h4>{t("pauseSeconds")}</h4>
          <p>{pauseSeconds.toFixed(1)}</p>
        </div>
        <div className="metric-card">
          <h4>{t("fillerCount")}</h4>
          <p>{fillerCount}</p>
        </div>
      </div>
      <p className="tiny">{t("signalsDisclaimer")}</p>
      {calibratingLabel && <p className="tiny">{calibratingLabel}</p>}
    </div>
  );
}
