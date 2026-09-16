"use client";

import { useState, useCallback } from "react";
import { FileAudio, Upload, Loader2 } from "lucide-react";

type ImportSheetProps = {
  isImporting: boolean;
  fileCount: number;
  onImport: (files: File[] | FileList | null) => void;
};

export function ImportSheet({ isImporting, fileCount, onImport }: ImportSheetProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        onImport(Array.from(e.dataTransfer.files));
      }
    },
    [onImport],
  );

  return (
    <div className="animate-fade-in space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 text-center transition-all duration-200 ${
          isDragging
            ? "border-daw-cyan bg-daw-cyan/10 shadow-glow-cyan"
            : "border-daw-line bg-white/[0.02] hover:border-daw-muted"
        } ${isImporting ? "pointer-events-none opacity-60" : ""}`}
      >
        {isImporting ? (
          <>
            <Loader2 className="mb-2 animate-spin text-daw-cyan" size={28} />
            <span className="text-sm font-medium text-daw-cyan">Decoding audio...</span>
          </>
        ) : (
          <>
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-daw-cyan/10">
              <FileAudio className="text-daw-cyan" size={24} />
            </div>
            <span className="text-sm font-medium text-daw-text">Tap to import audio files</span>
            <span className="mt-1 text-xs text-daw-muted">WAV, MP3, M4A, AIFF, FLAC, ZIP</span>
          </>
        )}
        <input
          type="file"
          accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
          multiple
          disabled={isImporting}
          className="sr-only"
          onChange={(e) => {
            onImport(Array.from(e.currentTarget.files ?? []));
            e.currentTarget.value = "";
          }}
        />
      </label>

      {fileCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl bg-daw-green/10 px-4 py-2.5 text-xs font-medium text-daw-green">
          <Upload size={14} />
          {fileCount} stem{fileCount !== 1 ? "s" : ""} loaded
        </div>
      )}
    </div>
  );
}
