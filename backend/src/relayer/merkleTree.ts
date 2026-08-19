import { createHash } from 'node:crypto';
import { MerkleProofNode } from '../schemas/stateProof';

export function sha256(buffer: Buffer): Buffer {
  return createHash('sha256').update(buffer).digest();
}

export function sha256Hex(buffer: Buffer): string {
  return `0x${sha256(buffer).toString('hex')}`;
}

export function hashPair(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([left, right]));
}

/**
 * Standard Merkle Tree implementation for Stellar/Soroban contract data state proofs.
 */
export class MerkleTree {
  private leaves: Buffer[];
  private layers: Buffer[][];

  constructor(leaves: Buffer[]) {
    if (leaves.length === 0) {
      throw new Error('MerkleTree requires at least one leaf');
    }
    this.leaves = leaves.map(l => Buffer.from(l));
    this.layers = [this.leaves];
    this.buildTree();
  }

  private buildTree(): void {
    let currentLayer = this.layers[0];
    while (currentLayer.length > 1) {
      const nextLayer: Buffer[] = [];
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : currentLayer[i]; // Duplicate odd leaf
        nextLayer.push(hashPair(left, right));
      }
      this.layers.push(nextLayer);
      currentLayer = nextLayer;
    }
  }

  public getRoot(): Buffer {
    return this.layers[this.layers.length - 1][0];
  }

  public getRootHex(): string {
    return `0x${this.getRoot().toString('hex')}`;
  }

  /**
   * Generates an audit path (proof) for a given leaf index.
   */
  public getProof(index: number): MerkleProofNode[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Leaf index ${index} out of bounds [0, ${this.leaves.length - 1}]`);
    }

    const proof: MerkleProofNode[] = [];
    let currentIndex = index;

    for (let level = 0; level < this.layers.length - 1; level++) {
      const layer = this.layers[level];
      const isRight = currentIndex % 2 === 0;
      const siblingIndex = isRight
        ? (currentIndex + 1 < layer.length ? currentIndex + 1 : currentIndex)
        : currentIndex - 1;

      const sibling = layer[siblingIndex];
      proof.push({
        sibling: `0x${sibling.toString('hex')}`,
        isRight, // True if the sibling is to the right of current node
      });

      currentIndex = Math.floor(currentIndex / 2);
    }

    return proof;
  }

  /**
   * Cryptographically verifies a proof against a known Merkle root.
   */
  public static verify(
    leaf: Buffer,
    proof: MerkleProofNode[],
    expectedRoot: Buffer
  ): boolean {
    let current: Buffer = Buffer.from(leaf);

    for (const node of proof) {
      const sibling = Buffer.from(node.sibling.replace(/^0x/, ''), 'hex');
      if (node.isRight) {
        current = Buffer.from(hashPair(current, sibling));
      } else {
        current = Buffer.from(hashPair(sibling, current));
      }
    }

    return current.equals(expectedRoot);
  }
}
