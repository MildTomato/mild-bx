import Link from 'next/link';

const concepts = [
  {
    title: 'Auth Rules',
    description: 'Declarative authorization in SQL. Claims, rules, column control.',
    href: '/docs/auth-rules',
  },
  {
    title: 'CLI',
    description: 'Schema sync, push/pull, live dev mode.',
    href: '/docs/cli',
  },
  {
    title: 'Workflows',
    description: 'Solo, staged, preview, or git-driven deployments.',
    href: '/docs/cli/workflow-profiles',
  },
  {
    title: 'Config',
    description: 'API and auth settings as code. Diff, sync, version.',
    href: '/docs/cli/getting-started',
  },
];

export function ConceptList() {
  return (
    <div className="space-y-4">
      {concepts.map((c) => (
        <Link key={c.title} href={c.href} className="block group">
          <span className="font-medium group-hover:underline">{c.title}</span>
          <span className="text-fd-muted-foreground ml-3">{c.description}</span>
        </Link>
      ))}
    </div>
  );
}
