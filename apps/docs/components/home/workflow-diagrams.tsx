const workflows = [
  {
    name: 'solo',
    tagline: 'Just ship it',
    art: `┌─────────┐              ┌──────────────┐
│  local  │ ──────────── │  production  │
└─────────┘   supa push  └──────────────┘`,
  },
  {
    name: 'staged',
    tagline: 'Safety net',
    art: `┌─────────┐              ┌───────────┐              ┌──────────────┐
│  local  │ ──────────── │  staging  │ ──────────── │  production  │
└─────────┘   supa push  └───────────┘  supa merge  └──────────────┘`,
  },
  {
    name: 'preview',
    tagline: 'Per-branch environments',
    art: `                         ┌────────────────┐
                    ┌──── │  preview/auth  │ ────┐
┌─────────┐         │     └────────────────┘     │     ┌──────────────┐
│  local  │ ────────┼──── │  preview/pay   │ ────┼──── │  production  │
└─────────┘         │     └────────────────┘     │     └──────────────┘
                    └──── │  preview/ui    │ ────┘
                          └────────────────┘`,
  },
];

export function WorkflowDiagrams() {
  return (
    <div className="space-y-12">
      {workflows.map((w) => (
        <div key={w.name}>
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="font-medium">{w.name}</h3>
            <span className="text-sm text-fd-muted-foreground">{w.tagline}</span>
          </div>
          <pre className="font-mono text-xs text-fd-muted-foreground overflow-x-auto">
            {w.art}
          </pre>
        </div>
      ))}
    </div>
  );
}
