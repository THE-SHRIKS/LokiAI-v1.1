import { type ReactNode } from "react";
import { X, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelProps {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, icon, actions, onClose, children, className, bodyClassName }: PanelProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden rounded-md border border-border bg-panel", className)}>
      <div className="panel-drag-handle flex shrink-0 cursor-move items-center gap-1.5 border-b border-border bg-panel-header px-2 py-1.5 text-xs">
        <GripVertical className="h-3 w-3 text-muted-foreground/50" />
        {icon}
        <span className="flex-1 truncate font-medium text-foreground">{title}</span>
        {actions}
        {onClose && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </div>
  );
}
