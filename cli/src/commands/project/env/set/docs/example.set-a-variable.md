You can also pipe values from stdin, which is useful for multi-line
values or reading from files:

```bash
cat cert.pem | supa project env set TLS_CERT
```
