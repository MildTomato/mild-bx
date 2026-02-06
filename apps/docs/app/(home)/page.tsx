import Link from 'next/link';
import { TbBook2, TbExternalLink } from 'react-icons/tb';
import { LogoShapesWave } from '@/components/logo';
import { Section, ConceptList, WorkflowDiagrams } from '@/components/home';

const linkClass =
  'inline-flex items-center gap-1.5 text-sm text-fd-muted-foreground hover:text-fd-foreground transition-colors hover:underline';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto">
        <LogoShapesWave className="mb-6" />
        <p className="text-fd-muted-foreground leading-relaxed max-w-lg">
          BX is Builder Experience. Experimental ideas for Supabase.
        </p>
        <div className="flex flex-wrap gap-4 text-sm mt-8">
          <Link href="/docs" className={`${linkClass} text-fd-foreground`}>
            <TbBook2 className="size-4 shrink-0" aria-hidden />
            Docs
          </Link>
        </div>
      </section>

      <Section>
        <ConceptList />
        <div className="mt-6 pt-6 border-t border-fd-border">
          <p className="text-xs text-fd-muted-foreground mb-2">External links</p>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link
              href="https://github.com/supabase/supabase-vscode-extension"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              GitHub
              <TbExternalLink className="size-4 shrink-0" aria-hidden />
            </Link>
            <Link
              href="https://github.com/mildtomato"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              mildtomato
              <TbExternalLink className="size-4 shrink-0" aria-hidden />
            </Link>
          </div>
        </div>
      </Section>

      <Section title="Workflows">
        <WorkflowDiagrams />
      </Section>
    </main>
  );
}
