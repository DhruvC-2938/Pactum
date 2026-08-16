import * as jose from 'jose';

/**
 * KmsService provides an isolated Key Management Service (KMS) environment
 * for the Pactum backend to hold signing keys securely.
 * In a production setup, this class can wrap AWS KMS or Google Cloud KMS.
 */
export class KmsService {
  private static instance: KmsService;
  private privateKey?: jose.KeyLike | Uint8Array;
  private publicKey?: jose.KeyLike | Uint8Array;

  private constructor() {}

  public static async getInstance(): Promise<KmsService> {
    if (!KmsService.instance) {
      KmsService.instance = new KmsService();
      await KmsService.instance.initialize();
    }
    return KmsService.instance;
  }

  private async initialize() {
    // Generate an ES256 asymmetric signing keypair.
    // The private key is securely held in-memory and never exposed outside this service.
    const { publicKey, privateKey } = await jose.generateKeyPair('ES256');
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  /**
   * Cryptographically signs a JWT payload using the KMS private key.
   */
  public async signJwt(payload: jose.JWTPayload): Promise<string> {
    if (!this.privateKey) {
      throw new Error('KMS has not been initialized');
    }
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
      .sign(this.privateKey);
    return jwt;
  }
}
