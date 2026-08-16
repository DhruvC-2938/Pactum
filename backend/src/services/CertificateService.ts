import { KmsService } from '../kms/KmsService';

export class CertificateService {
  /**
   * Generates a W3C-compliant Verifiable Credential in JWT format
   * containing the user's DID, their trust score, and a timestamp.
   * Includes a very short expiry time (1 hour) to prevent replay attacks.
   */
  public static async generateReputationCertificate(did: string, trustScore: number): Promise<string> {
    const kms = await KmsService.getInstance();
    
    // Calculate timestamps in seconds
    const now = Math.floor(Date.now() / 1000);
    const ONE_HOUR = 3600;
    const exp = now + ONE_HOUR;

    // Construct the W3C Verifiable Credential payload
    const payload = {
      iss: 'did:pactum:issuer',
      sub: did,
      vc: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'ReputationCredential'],
        credentialSubject: {
          id: did,
          trustScore: trustScore
        }
      },
      iat: now,
      exp: exp
    };

    return kms.signJwt(payload);
  }
}
