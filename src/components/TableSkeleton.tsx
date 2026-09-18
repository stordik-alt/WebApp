import { Skeleton } from "@/components/ui/skeleton";

// Desktop table-row placeholder. Works for both a bare <table> and the
// shadcn <Table>/<TableRow>/<TableCell> wrapper, since both render plain
// <tr>/<td> underneath - one shared skeleton instead of two near-identical
// components per table convention used across the app.
export function TableRowSkeleton({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-border/40">
          {Array.from({ length: columns }).map((_, j) => (
            <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full max-w-[140px]" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Mobile-card placeholder, matching the `rounded-xl border border-border/60
// bg-slate-950/35 p-3` card shape already established for the md:hidden
// list views across the app.
export function CardSkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/60 bg-slate-950/35 p-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
