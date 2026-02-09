Sets a single environment variable on the remote environment. If the
variable already exists, its value is updated. Pass `--secret` to
mark it as write-only so it's never returned in list or pull
operations.

If you omit the value argument, the command reads from stdin, which
is useful for piping in multi-line values or reading from files.
