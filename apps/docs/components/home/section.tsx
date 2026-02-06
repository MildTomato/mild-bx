import { ReactNode } from 'react';

interface SectionProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function Section({ title, children, className = '' }: SectionProps) {
  return (
    <section className={`px-6 pb-24 max-w-3xl mx-auto ${className}`}>
      {title && (
        <h2 className="text-xs font-medium text-fd-muted-foreground tracking-widest uppercase mb-8">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}
