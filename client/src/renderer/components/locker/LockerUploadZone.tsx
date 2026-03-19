import { useState, useCallback } from "react";

interface LockerUploadZoneProps {
  onFileDrop: () => void;
  children: React.ReactNode;
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(233, 69, 96, 0.15)",
  border: "2px dashed #e94560",
  borderRadius: 8,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 50,
  pointerEvents: "none",
};

const overlayText: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 600,
  color: "#e94560",
  backgroundColor: "#16213e",
  padding: "16px 32px",
  borderRadius: 8,
};

export function LockerUploadZone({ onFileDrop, children }: LockerUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useState(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter[1]((c) => {
      const next = c + 1;
      if (next === 1) setIsDragging(true);
      return next;
    });
  }, [dragCounter]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter[1]((c) => {
      const next = c - 1;
      if (next <= 0) {
        setIsDragging(false);
        return 0;
      }
      return next;
    });
  }, [dragCounter]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter[1](0);
    // We can't directly access local file paths from drag events in a secure
    // Electron context. Instead, trigger the native file dialog via IPC.
    onFileDrop();
  }, [onFileDrop, dragCounter]);

  return (
    <div
      style={{ position: "relative", minHeight: "100%" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div style={overlayStyle}>
          <div style={overlayText}>Drop files to upload</div>
        </div>
      )}
      {children}
    </div>
  );
}
