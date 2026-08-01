export function Logo({ className = "" }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="LokiAI logomark"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className="font-serif text-xl leading-none tracking-tight text-gold">LokiAI</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
        by The Shriks
      </span>
    </span>
  );
}
