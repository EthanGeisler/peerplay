import { useEffect, useState } from "react";

interface VideoPlayerProps {
  installPath: string;
}

export function VideoPlayer({ installPath }: VideoPlayerProps) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Get the first media file in the install directory
        const filePath = await window.boilerdeck.media.getFilePath(installPath);
        if (cancelled) return;

        if (!filePath) {
          setError("No media file found in download directory");
          setLoading(false);
          return;
        }

        // Start local HTTP server and get streaming URL
        const url = await window.boilerdeck.media.startServer(installPath, filePath);
        if (cancelled) return;

        setVideoUrl(url);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start media server");
          setLoading(false);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, [installPath]);

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
        Loading video player...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#e94560" }}>
        {error}
      </div>
    );
  }

  if (!videoUrl) return null;

  return (
    <div style={{ marginTop: 16, maxWidth: 720 }}>
      <video
        src={videoUrl}
        controls
        style={{
          width: "100%",
          borderRadius: 8,
          backgroundColor: "#000",
        }}
      />
    </div>
  );
}
