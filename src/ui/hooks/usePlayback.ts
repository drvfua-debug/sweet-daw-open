"use client";

import { useCallback, useEffect } from "react";
import { audioEngine } from "@/audio/engine/AudioEngine";
import { getProjectDurationSec } from "@/audio/engine/TrackGraph";
import { SWEET_DAW_BUILD_INFO } from "@/generated/buildInfo";
import type { Project } from "@/daw/model/Project";

type TransportState = {
  isPlaying: boolean;
  positionSec: number;
  loopEnabled: boolean;
};

export function usePlayback(
  project: Project,
  transport: TransportState,
  setTransport: (patch: Partial<TransportState>) => void,
  setPosition: (positionSec: number) => void,
  addDebug: (message: string) => void,
  setEngineInfo: React.Dispatch<React.SetStateAction<Record<string, string | number | null>>>,
) {
  const durationSec = getProjectDurationSec(project);

  useEffect(() => {
    audioEngine.syncProject(project);
  }, [project]);

  useEffect(() => {
    if (!transport.isPlaying) return;

    const interval = window.setInterval(() => {
      const position = audioEngine.getCurrentPosition();
      if (durationSec > 0 && position >= durationSec) {
        if (transport.loopEnabled) {
          setPosition(0);
          setTransport({ isPlaying: true, positionSec: 0 });
          void audioEngine.play(project, 0);
          addDebug("Loop restart");
          return;
        }

        audioEngine.stop();
        setTransport({ isPlaying: false, positionSec: 0 });
        return;
      }

      setPosition(position);
      const info = audioEngine.getDebugInfo();
      setEngineInfo({
        context: info.state,
        build: SWEET_DAW_BUILD_INFO.buildId,
        sampleRate: info.sampleRate,
        tracks: project.tracks.length,
        clips: project.clips.length,
        duration: `${durationSec.toFixed(2)}s`,
      });
    }, 100);

    return () => window.clearInterval(interval);
  }, [addDebug, durationSec, project, setPosition, setTransport, transport.isPlaying, transport.loopEnabled, setEngineInfo]);

  useEffect(() => {
    setEngineInfo((current) => ({
      ...current,
      build: SWEET_DAW_BUILD_INFO.buildId,
      tracks: project.tracks.length,
      clips: project.clips.length,
      duration: `${durationSec.toFixed(2)}s`,
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 64),
    }));
  }, [durationSec, project.clips.length, project.tracks.length, setEngineInfo]);

  const handlePlay = useCallback(async () => {
    try {
      const startPosition = durationSec > 0 && transport.positionSec >= durationSec ? 0 : transport.positionSec;
      await audioEngine.play(project, startPosition);
      setTransport({ isPlaying: true });
      addDebug(`Playback start at ${startPosition.toFixed(2)}s`);
    } catch (error) {
      addDebug(error instanceof Error ? `Playback failed: ${error.message}` : "Playback failed");
    }
  }, [addDebug, durationSec, project, setTransport, transport.positionSec]);

  const handlePause = useCallback(() => {
    const position = audioEngine.pause();
    setTransport({ isPlaying: false, positionSec: position });
    addDebug(`Paused at ${position.toFixed(2)}s`);
  }, [addDebug, setTransport]);

  const handleStop = useCallback(() => {
    audioEngine.stop();
    setTransport({ isPlaying: false, positionSec: 0 });
    addDebug("Stopped");
  }, [addDebug, setTransport]);

  const handleSeek = useCallback(
    async (positionSec: number) => {
      setPosition(positionSec);
      await audioEngine.seek(project, positionSec, transport.isPlaying);
    },
    [project, setPosition, transport.isPlaying],
  );

  return { handlePlay, handlePause, handleStop, handleSeek, durationSec };
}
