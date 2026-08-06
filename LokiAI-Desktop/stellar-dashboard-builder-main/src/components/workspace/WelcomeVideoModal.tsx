import { useRef, useState } from "react";
import { X, Volume2, VolumeX, Play } from "lucide-react";
import lokiaiLogoUrl from "@/assets/lokiai-logo.png";

interface WelcomeVideoModalProps {
  /** Called when the user skips, closes, or the video finishes. */
  onClose: () => void;
}

/// Founder welcome video shown once, before the NIM key gate on a brand new
/// account (and replayable any time from the sidebar). Skippable — this is
/// an introduction, not a blocker, unlike NimKeyModal.
export function WelcomeVideoModal({ onClose }: WelcomeVideoModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [started, setStarted] = useState(false);

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const handlePlayClick = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    v.play().catch(() => {
      // Autoplay-with-sound can still be refused by the browser — fall back
      // to muted playback rather than leaving the video stalled.
      v.muted = true;
      setMuted(true);
      v.play().catch(() => undefined);
    });
    setStarted(true);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/90 backdrop-blur-sm px-4">
      <div className="flex w-full max-w-2xl flex-col items-center gap-4">
        <img src={lokiaiLogoUrl} alt="LokiAI" className="h-7 w-24 object-cover object-center" />

        <div className="relative w-full overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
          <button
            onClick={onClose}
            aria-label="Skip"
            className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-sm transition-colors hover:bg-background/90 hover:text-foreground"
          >
            Skip <X className="h-3 w-3" />
          </button>

          <div className="relative aspect-video w-full bg-black">
            <video
              ref={videoRef}
              src="/welcome.mp4"
              autoPlay
              muted
              playsInline
              onPlay={() => setStarted(true)}
              onEnded={onClose}
              controls={started}
              className="h-full w-full object-contain"
            />

            {!started && (
              <button
                onClick={handlePlayClick}
                className="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors hover:bg-black/30"
                aria-label="Play with sound"
              >
                <span className="grid h-16 w-16 place-items-center rounded-full bg-background/80 text-foreground shadow-lg transition-transform hover:scale-105">
                  <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                </span>
              </button>
            )}

            {started && (
              <button
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="absolute bottom-3 right-3 z-10 rounded-full bg-background/70 p-2 text-foreground backdrop-blur-sm transition-colors hover:bg-background/90"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">
              A quick welcome from the LokiAI team before you get started.
            </p>
            <button
              onClick={onClose}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
