"use client";

import { useRef, useState } from "react";

/**
 * Reads a secret JSON file into memory only. Nothing is written to localStorage,
 * sessionStorage, IndexedDB, cookies, or sent to any server. Reloading the page forgets it.
 */
export function FileLoader({
  label,
  hint,
  loadedName,
  onLoad,
  onClear,
}: {
  label: string;
  hint?: string;
  loadedName?: string | null;
  onLoad: (json: unknown, fileName: string) => string | null; // return an error message, or null if accepted
  onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function read(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > 2_000_000) {
      setError("File is too large to be an ExamSeal secret file.");
      return;
    }
    try {
      const text = await file.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        setError(`${file.name} is not valid JSON.`);
        return;
      }
      const problem = onLoad(json, file.name);
      if (problem) setError(problem);
    } finally {
      if (input.current) input.current.value = "";
    }
  }

  if (loadedName) {
    return (
      <div className="fileloader fileloader-loaded">
        <span>
          Loaded <span className="mono">{loadedName}</span> <span className="muted">(in memory only)</span>
        </span>
        {onClear && (
          <button type="button" className="btn-mini" onClick={onClear}>
            Unload
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <label
        className={`fileloader ${dragging ? "fileloader-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          read(e.dataTransfer.files?.[0]);
        }}
      >
        <input ref={input} type="file" accept=".json,application/json" onChange={(e) => read(e.target.files?.[0])} hidden />
        <strong>{label}</strong>
        <span className="muted">{hint ?? "Choose or drop the file. It stays in this tab's memory and is never uploaded."}</span>
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
