"use client";

import { useEffect, useState } from "react";
import { audioEngine } from "@/audio/engine/AudioEngine";
import type { ActiveView } from "@/daw/store/dawStore";
import type { Track } from "@/daw/model/Project";

type MeterUiReading = {
  rms: number;
  peak: number;
  clipping: boolean;
};

export function useMetering(
  tracks: Track[],
  isPlaying: boolean,
  activeView: ActiveView,
) {
  const [meterReadings, setMeterReadings] = useState<Record<string, MeterUiReading>>({});
  const [masterMeter, setMasterMeter] = useState<MeterUiReading>({
    rms: -60,
    peak: -60,
    clipping: false,
  });

  useEffect(() => {
    if (!isPlaying && activeView !== "mix") return;

    let rafId = 0;
    let lastRead = 0;

    const tick = (now: number) => {
      if (now - lastRead >= 33) {
        lastRead = now;
        if (tracks.length > 0) {
          setMeterReadings(audioEngine.readMeters(tracks.map((track) => track.id)));
        }
        setMasterMeter(audioEngine.readMeter("master"));
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeView, tracks, isPlaying]);

  return { meterReadings, masterMeter };
}
