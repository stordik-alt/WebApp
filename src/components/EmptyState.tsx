import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";

export function EmptyState({ icon: Icon = Inbox, title, description, className }: { icon?: LucideIcon; title: string; description?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 py-10 text-center ${className ?? ""}`}>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-muted/60 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}
