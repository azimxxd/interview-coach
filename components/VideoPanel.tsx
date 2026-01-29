"use client";

import { useEffect } from "react";
import { useUi } from "@/components/UiProvider";

type VideoPanelProps = {
  stream: MediaStream | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  onRequestPermissions: () => void | Promise<MediaStream | null>;
  error?: string | null;
  isCalibrating: boolean;
};

export default function VideoPanel({
  stream,
  videoRef,
  onRequestPermissions,
  error,
  isCalibrating
}: VideoPanelProps) {
  const { t } = useUi();
  useEffect(() => {
    if (!videoRef.current) return;
    if (stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    } else {
      videoRef.current.srcObject = null;
    }
  }, [stream, videoRef]);

  return (
    <div className="card stack">
      <div className="video-frame">
        <video ref={videoRef} muted playsInline />
        <div className="video-overlay">
          <span className="pill">{t("cameraPreview")}</span>
          {isCalibrating && <span className="pill">{t("calibrating")}</span>}
        </div>
      </div>
      <div className="controls">
        <button className="btn btn-primary" onClick={onRequestPermissions}>
          {t("enableCameraMic")}
        </button>
      </div>
      {error && (
        <p className="tiny">
          {t("permissionError")}: {error}
        </p>
      )}
      <p className="disclaimer">{t("permissionsDisclaimer")}</p>
    </div>
  );
}
