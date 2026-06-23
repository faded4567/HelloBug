import { SignJWT, jwtVerify } from "jose";

export interface IssuedJwt {
  jwt: string;
  expiresAt: number;
}

export class JwtManager {
  private readonly secretBytes: Uint8Array;

  constructor(
    private readonly secret: string,
    private readonly issuer = "hellobug-server",
  ) {
    this.secretBytes = new TextEncoder().encode(secret);
  }

  async issue(deviceId: string, ttlSeconds = 60 * 60): Promise<IssuedJwt> {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const jwt = await new SignJWT({ device_id: deviceId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(expiresAt)
      .sign(this.secretBytes);

    return {
      jwt,
      expiresAt: expiresAt * 1000,
    };
  }

  async verify(token: string): Promise<{ deviceId: string }> {
    const { payload } = await jwtVerify(token, this.secretBytes, {
      issuer: this.issuer,
    });

    const deviceId = payload.device_id;
    if (typeof deviceId !== "string" || deviceId.length === 0) {
      throw new Error("JWT missing device_id");
    }

    return { deviceId };
  }

  exportSecret(): string {
    return this.secret;
  }
}
