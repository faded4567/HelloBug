import forge from "node-forge";

export interface SignedClientCertificate {
  certPem: string;
  caCertPem: string;
}

export class CertificateAuthority {
  private constructor(
    public readonly caCertPem: string,
    private readonly caKeyPem: string,
  ) {}

  static async create(commonName = "HelloBug Local CA"): Promise<CertificateAuthority> {
    const keys = await new Promise<forge.pki.rsa.KeyPair>((resolve, reject) => {
      forge.pki.rsa.generateKeyPair(
        { bits: 2048, workers: 2 },
        (error: Error | null, pair: forge.pki.rsa.KeyPair) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(pair);
        },
      );
    });

    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = Date.now().toString(16);
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const attrs = [{ name: "commonName", value: commonName }];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, digitalSignature: true },
      { name: "subjectKeyIdentifier" },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());

    return new CertificateAuthority(
      forge.pki.certificateToPem(cert),
      forge.pki.privateKeyToPem(keys.privateKey),
    );
  }

  static fromState(state: {
    caCertPem: string;
    caKeyPem: string;
  }): CertificateAuthority {
    return new CertificateAuthority(state.caCertPem, state.caKeyPem);
  }

  signClientCertificate(deviceId: string): SignedClientCertificate {
    const caCert = forge.pki.certificateFromPem(this.caCertPem);
    const caKey = forge.pki.privateKeyFromPem(this.caKeyPem);
    const clientKeys = forge.pki.rsa.generateKeyPair(2048);

    const cert = forge.pki.createCertificate();
    cert.publicKey = clientKeys.publicKey;
    cert.serialNumber = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    cert.setSubject([{ name: "commonName", value: deviceId }]);
    cert.setIssuer(caCert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false },
      {
        name: "keyUsage",
        digitalSignature: true,
        keyEncipherment: true,
      },
      { name: "extKeyUsage", clientAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: deviceId }] },
    ]);
    cert.sign(caKey, forge.md.sha256.create());

    return {
      certPem: forge.pki.certificateToPem(cert),
      caCertPem: this.caCertPem,
    };
  }

  exportState(): {
    caCertPem: string;
    caKeyPem: string;
  } {
    return {
      caCertPem: this.caCertPem,
      caKeyPem: this.caKeyPem,
    };
  }
}
