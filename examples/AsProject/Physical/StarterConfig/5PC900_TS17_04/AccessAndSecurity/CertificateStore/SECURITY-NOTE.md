# Demo Certificate — Do Not Trust

The certificate and private key under this directory (`OwnCertificates/Certificates/Example.cer`
and `OwnCertificates/PrivateKeys/Example.key`) are a **publicly known self-signed
certificate** shipped only so users can spin up the example mapp Connect server
over HTTPS without first generating their own cert.

## What this means

- The private key is committed to a public repository. **Anyone** has it.
- The cert is self-signed (subject `C=US`, SAN `br-automation` / `127.0.0.1`). No
  browser or client trusts it by default — every connection prompts a warning.
- This cert proves no identity and grants no access. It exists to make the demo
  reachable on `https://` instead of `http://`.

## Do not

- Deploy any system that adds this cert to a trust store.
- Use this cert or key on a device that is reachable from an untrusted network.
- Copy this key into any non-example project.

## Before using the example on real hardware

Regenerate a fresh certificate and private key in Automation Studio
(`AccessAndSecurity → CertificateStore → OwnCertificates`) and replace the files
in this directory. The committed demo cert is for local development against the
example project only.
