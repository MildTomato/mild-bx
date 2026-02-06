import Link from 'next/link';
import { Section, ConceptList, WorkflowDiagrams } from '@/components/home';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <section className="px-6 pt-24 pb-16 max-w-3xl mx-auto">
        <p className="text-fd-muted-foreground leading-relaxed max-w-lg">
          Experimental DX tools for Supabase. Authorization, schema sync,
          config-as-code.
        </p>
        <div className="flex gap-4 text-sm mt-8">
          <Link href="/docs" className="text-fd-foreground hover:underline">
            Docs
          </Link>
          <Link
            href="https://github.com/supabase/supabase-vscode-extension"
            className="text-fd-muted-foreground hover:text-fd-foreground transition-colors"
          >
            GitHub
          </Link>
        </div>
      </section>

      <Section>
        <ConceptList />
      </Section>

      <Section title="Workflows">
        <WorkflowDiagrams />
      </Section>
    </main>
  );
}
