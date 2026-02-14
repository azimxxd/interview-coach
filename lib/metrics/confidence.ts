import type { InterviewTurn } from "@/lib/storage/session";

type ConfidenceInput = {
  wpm?: number;
  filler_count?: number;
  pauses_sec?: number;
  duration_sec?: number;
};

type ConfidenceComponents = {
  wpmScore: number;
  fillerScore: number;
  pauseScore: number;
};

type ConfidenceDerived = {
  fpm: number;
  pauseRatio: number;
};

type ConfidenceTurnResult = {
  score: number;
  components: ConfidenceComponents;
  derived: ConfidenceDerived;
};

type ConfidenceOverallResult = {
  score: number;
  components: ConfidenceComponents;
  derived: ConfidenceDerived;
  notes: {
    totalDuration: number;
    weighted: boolean;
    missingDurationCount: number;
  };
};

function safeNumber(value: unknown, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeWpmScore(wpm: number) {
  if (wpm < 80 || wpm > 200) return 0;
  if (wpm >= 120 && wpm <= 160) return 1;
  if (wpm >= 80 && wpm < 120) return (wpm - 80) / 40;
  return 1 - (wpm - 160) / 40;
}

function computeFillerScore(fpm: number) {
  if (fpm <= 2) return 1;
  if (fpm >= 6) return 0;
  return 1 - (fpm - 2) / 4;
}

function computePauseScore(pauseRatio: number) {
  if (pauseRatio <= 0.1) return 1;
  if (pauseRatio >= 0.3) return 0;
  return 1 - (pauseRatio - 0.1) / 0.2;
}

export function computeConfidenceTurn(input: ConfidenceInput): ConfidenceTurnResult {
  const wpm = safeNumber(input.wpm);
  const fillerCount = safeNumber(input.filler_count);
  const pausesSec = safeNumber(input.pauses_sec);
  const durationSec = Math.max(0, safeNumber(input.duration_sec));

  const wpmScore = clamp01(computeWpmScore(wpm));

  const durationMinutes = durationSec > 0 ? durationSec / 60 : 0;
  const fpm = durationMinutes > 0 ? fillerCount / durationMinutes : 0;
  const fillerScore = durationSec > 0 ? clamp01(computeFillerScore(fpm)) : 0;

  const pauseRatio = durationSec > 0 ? pausesSec / durationSec : 0;
  const pauseScore = durationSec > 0 ? clamp01(computePauseScore(pauseRatio)) : 0;

  const confidence01 = wpmScore * 0.4 + fillerScore * 0.35 + pauseScore * 0.25;
  const score = Math.min(100, Math.max(0, Math.round(confidence01 * 100)));

  if (process.env.NODE_ENV !== "production") {
    if (!Number.isFinite(score)) {
      // Simple guard to avoid surfacing NaN in UI.
      console.warn("Confidence score invalid", { wpm, fillerCount, pausesSec, durationSec });
    }
  }

  return {
    score,
    components: { wpmScore, fillerScore, pauseScore },
    derived: { fpm, pauseRatio }
  };
}

export function computeConfidenceOverall(turns: InterviewTurn[]): ConfidenceOverallResult {
  const results = turns.map((turn) => {
    const signals = turn.signals ?? {
      wpm: 0,
      filler_count: 0,
      pauses_sec: 0
    };
    const durationSec = Math.max(0, safeNumber(signals.duration_sec));
    return {
      durationSec,
      result: computeConfidenceTurn({
        wpm: signals.wpm,
        filler_count: signals.filler_count,
        pauses_sec: signals.pauses_sec ?? 0,
        duration_sec: durationSec
      })
    };
  });

  const totalDuration = results.reduce((sum, item) => sum + item.durationSec, 0);
  const missingDurationCount = results.filter((item) => item.durationSec <= 0).length;

  const weighted = totalDuration > 0;
  const divisor = weighted ? totalDuration : Math.max(1, results.length);

  const scoreSum = results.reduce((sum, item) => {
    const weight = weighted ? item.durationSec : 1;
    return sum + item.result.score * weight;
  }, 0);

  const componentSum = results.reduce(
    (sum, item) => {
      const weight = weighted ? item.durationSec : 1;
      return {
        wpmScore: sum.wpmScore + item.result.components.wpmScore * weight,
        fillerScore: sum.fillerScore + item.result.components.fillerScore * weight,
        pauseScore: sum.pauseScore + item.result.components.pauseScore * weight
      };
    },
    { wpmScore: 0, fillerScore: 0, pauseScore: 0 }
  );

  const derivedSum = results.reduce(
    (sum, item) => {
      const weight = weighted ? item.durationSec : 1;
      return {
        fpm: sum.fpm + item.result.derived.fpm * weight,
        pauseRatio: sum.pauseRatio + item.result.derived.pauseRatio * weight
      };
    },
    { fpm: 0, pauseRatio: 0 }
  );

  return {
    score: Math.round(scoreSum / divisor),
    components: {
      wpmScore: componentSum.wpmScore / divisor,
      fillerScore: componentSum.fillerScore / divisor,
      pauseScore: componentSum.pauseScore / divisor
    },
    derived: {
      fpm: derivedSum.fpm / divisor,
      pauseRatio: derivedSum.pauseRatio / divisor
    },
    notes: {
      totalDuration,
      weighted,
      missingDurationCount
    }
  };
}
