"use client";

import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-assets/face_landmarker.task";
const CALIBRATION_MS = 2000;

type FaceMetrics = {
  eyeContactPct: number;
  smileProxy: number;
  isCalibrating: boolean;
};

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getLandmark(result: any, index: number) {
  const landmarks = result.faceLandmarks?.[0];
  return landmarks && landmarks[index];
}

export function useFaceMetrics(
  videoRef: React.RefObject<HTMLVideoElement>,
  isActive: boolean
): FaceMetrics {
  const [eyeContactPct, setEyeContactPct] = useState(0);
  const [smileProxy, setSmileProxy] = useState(0);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const statsRef = useRef({
    total: 0,
    eyeContact: 0,
    smileSum: 0
  });

  useEffect(() => {
    let isCancelled = false;
    async function init() {
      if (faceLandmarkerRef.current) return;
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_URL
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false
        });
        if (!isCancelled) {
          faceLandmarkerRef.current = landmarker;
        } else {
          landmarker.close();
        }
      } catch {
        // Leave metrics at defaults if initialization fails.
      }
    }
    init();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isActive) {
      setIsCalibrating(false);
      return;
    }
    startTimeRef.current = performance.now();
    statsRef.current = { total: 0, eyeContact: 0, smileSum: 0 };
    setEyeContactPct(0);
    setSmileProxy(0);
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let rafId = 0;

    const loop = () => {
      const video = videoRef.current;
      const landmarker = faceLandmarkerRef.current;
      if (!video || !landmarker) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      if (video.readyState < 2) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      const now = performance.now();
      let result: any;
      try {
        result = landmarker.detectForVideo(video, now);
      } catch {
        rafId = requestAnimationFrame(loop);
        return;
      }
      const elapsed = startTimeRef.current ? now - startTimeRef.current : 0;
      const calibrating = elapsed < CALIBRATION_MS;
      setIsCalibrating(calibrating);

      if (result.faceLandmarks?.length) {
        const nose = getLandmark(result, 1) ?? getLandmark(result, 4);
        const leftEye =
          getLandmark(result, 33) ?? getLandmark(result, 133);
        const rightEye =
          getLandmark(result, 362) ?? getLandmark(result, 263);
        const mouthLeft = getLandmark(result, 61);
        const mouthRight = getLandmark(result, 291);

        if (nose && leftEye && rightEye) {
          const eyeCenter = distance(leftEye, rightEye);
          const mouthWidth =
            mouthLeft && mouthRight
              ? distance(mouthLeft, mouthRight)
              : eyeCenter;
          const smile = eyeCenter > 0 ? mouthWidth / eyeCenter : 0;

          const centered =
            Math.abs(nose.x - 0.5) < 0.12 && Math.abs(nose.y - 0.5) < 0.16;
          const yawProxy =
            eyeCenter > 0
              ? Math.abs((nose.x - leftEye.x) - (rightEye.x - nose.x)) /
                eyeCenter
              : 1;
          const facing = yawProxy < 0.18;
          const eyeContact = centered && facing;

          if (!calibrating) {
            statsRef.current.total += 1;
            if (eyeContact) statsRef.current.eyeContact += 1;
            statsRef.current.smileSum += smile;
            const pct =
              statsRef.current.total > 0
                ? (statsRef.current.eyeContact / statsRef.current.total) * 100
                : 0;
            setEyeContactPct(pct);
            setSmileProxy(
              statsRef.current.smileSum / statsRef.current.total
            );
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef, isActive]);

  return { eyeContactPct, smileProxy, isCalibrating };
}
