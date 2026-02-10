import { cn } from "@/lib/utils";

function LogoText() {
  return <span className="font-medium text-fg">Mild BX</span>;
}

export function LogoShapesWave({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 group cursor-default", className)}>
      <div className="flex items-end gap-1">
        <div className="w-2.5 h-2.5 bg-orange-500 rounded-sm transition-transform duration-300 ease-out group-hover:-translate-y-2" style={{ transitionDelay: "0ms" }} />
        <div className="w-2.5 h-2.5 bg-orange-500/80 rounded-full transition-transform duration-300 ease-out group-hover:-translate-y-3" style={{ transitionDelay: "50ms" }} />
        <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[10px] border-b-orange-500/60 transition-transform duration-300 ease-out group-hover:-translate-y-2" style={{ transitionDelay: "100ms" }} />
        <div className="w-2.5 h-2.5 bg-orange-500/45 rounded-sm rotate-45 transition-transform duration-300 ease-out group-hover:-translate-y-3" style={{ transitionDelay: "150ms" }} />
        <div className="w-2.5 h-2.5 bg-orange-500/30 rounded-full transition-transform duration-300 ease-out group-hover:-translate-y-2" style={{ transitionDelay: "200ms" }} />
      </div>
      <LogoText />
    </div>
  );
}
