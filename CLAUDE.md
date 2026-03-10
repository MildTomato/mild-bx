## Subagent Models

Always use the Task tool to delegate work to subagents with the appropriate model. Do not default to doing everything in the main conversation — prefer spawning focused subagents for each step of a task:

- **Explore** (codebase search, file reading, research): `model: "haiku"`
- **Plan** (architecture, design, implementation planning): `model: "opus"`
- **Implementation** (code editing, writing files, running commands): `model: "sonnet"`
