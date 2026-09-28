import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { ExamSealRegistry } from "../typechain-types";
import fixture from "./fixtures/fingerprint-commitment.json";

const Status = { None: 0n, Sealed: 1n, Released: 2n, Compromised: 3n };
const Skip = { Compromised: 1, Duplicate: 2, UnknownCentre: 3, BadLength: 4 };

const coder = ethers.AbiCoder.defaultAbiCoder();
const rand = (n: number) => ethers.hexlify(ethers.randomBytes(n));
const share = () => rand(93); // sealed piece size per CLAUDE.md §7

async function now(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
}

async function setTime(ts: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
  await ethers.provider.send("evm_mine", []);
}

function fpCommitment(examId: bigint, centreId: number, fingerprint: string, salt: string) {
  return ethers.keccak256(
    coder.encode(["uint256", "uint32", "bytes", "bytes32"], [examId, centreId, fingerprint, salt])
  );
}

describe("ExamSealRegistry", () => {
  let registry: ExamSealRegistry;
  let authority: HardhatEthersSigner;
  let custodians: HardhatEthersSigner[];
  let outsider: HardhatEthersSigner;
  let custodianAddrs: string[];

  beforeEach(async () => {
    const signers = await ethers.getSigners();
    authority = signers[0];
    custodians = signers.slice(1, 6);
    outsider = signers[6];
    custodianAddrs = custodians.map((c) => c.address);
    const Factory = await ethers.getContractFactory("ExamSealRegistry");
    registry = await Factory.deploy();
    await registry.waitForDeployment();
  });

  async function createExam(opts: { releaseIn?: number; revealAfter?: number; threshold?: number } = {}) {
    const t = await now();
    const releaseTime = t + (opts.releaseIn ?? 1000);
    const revealTime = releaseTime + (opts.revealAfter ?? 500);
    await registry.createExam(
      "Demo exam",
      ethers.keccak256(ethers.toUtf8Bytes("paper")),
      releaseTime,
      revealTime,
      custodianAddrs,
      opts.threshold ?? 3
    );
    const examId = (await registry.nextExamId()) - 1n;
    return { examId, releaseTime, revealTime };
  }

  async function register(examId: bigint, centreIds: number[], fpCommits?: string[]) {
    const keys = centreIds.map(() => rand(32));
    const commits = fpCommits ?? centreIds.map(() => rand(32));
    const cts = centreIds.map(() => rand(200));
    await registry.registerCentres(examId, centreIds, keys, commits, cts);
    return { keys, commits, cts };
  }

  // ---------------------------------------------------------------- createExam

  describe("createExam", () => {
    it("creates exams with incrementing ids starting at 1 and stores fields", async () => {
      expect(await registry.nextExamId()).to.equal(1n);
      const t = await now();
      const paper = ethers.keccak256(ethers.toUtf8Bytes("paper"));
      await expect(registry.createExam("Exam A", paper, t + 100, t + 200, custodianAddrs, 3))
        .to.emit(registry, "ExamCreated")
        .withArgs(1n, authority.address, "Exam A", paper, t + 100, t + 200, 3, custodianAddrs);
      const blockNumber = await ethers.provider.getBlockNumber();

      const exam = await registry.getExam(1n);
      expect(exam.authority).to.equal(authority.address);
      expect(exam.title).to.equal("Exam A");
      expect(exam.paperCommitment).to.equal(paper);
      expect(exam.releaseTime).to.equal(BigInt(t + 100));
      expect(exam.revealTime).to.equal(BigInt(t + 200));
      expect(exam.threshold).to.equal(3n);
      expect(exam.centreCount).to.equal(0n);
      expect(exam.createdBlock).to.equal(BigInt(blockNumber));
      expect(exam.custodians).to.deep.equal(custodianAddrs);

      await registry.createExam("Exam B", paper, t + 100, t + 100, custodianAddrs, 2);
      expect(await registry.nextExamId()).to.equal(3n);
    });

    it("rejects bad thresholds", async () => {
      const t = await now();
      const p = ethers.ZeroHash;
      await expect(registry.createExam("x", p, t + 100, t + 200, custodianAddrs, 1)).to.be.revertedWithCustomError(
        registry,
        "BadThreshold"
      );
      await expect(registry.createExam("x", p, t + 100, t + 200, custodianAddrs, 0)).to.be.revertedWithCustomError(
        registry,
        "BadThreshold"
      );
      await expect(registry.createExam("x", p, t + 100, t + 200, custodianAddrs, 6)).to.be.revertedWithCustomError(
        registry,
        "BadThreshold"
      );
    });

    it("rejects bad times", async () => {
      const t = await now();
      const p = ethers.ZeroHash;
      // releaseTime not in the future (next block is t+1)
      await expect(registry.createExam("x", p, t, t + 200, custodianAddrs, 3)).to.be.revertedWithCustomError(
        registry,
        "BadTimes"
      );
      // revealTime before releaseTime
      await expect(registry.createExam("x", p, t + 100, t + 99, custodianAddrs, 3)).to.be.revertedWithCustomError(
        registry,
        "BadTimes"
      );
    });

    it("rejects duplicate, zero, or too many custodians", async () => {
      const t = await now();
      const p = ethers.ZeroHash;
      const dup = [custodianAddrs[0], custodianAddrs[1], custodianAddrs[0]];
      await expect(registry.createExam("x", p, t + 100, t + 200, dup, 2)).to.be.revertedWithCustomError(
        registry,
        "BadCustodians"
      );
      const zero = [custodianAddrs[0], ethers.ZeroAddress, custodianAddrs[1]];
      await expect(registry.createExam("x", p, t + 100, t + 200, zero, 2)).to.be.revertedWithCustomError(
        registry,
        "BadCustodians"
      );
      const eleven = Array.from({ length: 11 }, () => ethers.Wallet.createRandom().address);
      await expect(registry.createExam("x", p, t + 100, t + 200, eleven, 3)).to.be.revertedWithCustomError(
        registry,
        "BadCustodians"
      );
    });

    it("unknown exam reverts ExamNotFound", async () => {
      await expect(registry.getExam(99n)).to.be.revertedWithCustomError(registry, "ExamNotFound");
    });
  });

  // ---------------------------------------------------------------- registerCentres

  describe("registerCentres", () => {
    it("registers centres, computes the variant commitment on-chain, and emits events", async () => {
      const { examId } = await createExam();
      const key = rand(32);
      const fp = rand(32);
      const ct = rand(300);
      const expected = ethers.keccak256(ct);

      const tx = registry.registerCentres(examId, [14], [key], [fp], [ct]);
      await expect(tx).to.emit(registry, "CentreRegistered").withArgs(examId, 14, key, expected, fp);
      await expect(tx).to.emit(registry, "EncryptedVariantPublished").withArgs(examId, 14, ct);
      const blockNumber = await ethers.provider.getBlockNumber();

      const c = await registry.getCentre(examId, 14);
      expect(c.status).to.equal(Status.Sealed);
      expect(c.approvals).to.equal(0n);
      expect(c.encPubKey).to.equal(key);
      expect(c.variantCommitment).to.equal(expected);
      expect(c.fingerprintCommitment).to.equal(fp);
      expect(c.registeredBlock).to.equal(BigInt(blockNumber));
      expect(c.fingerprintRevealed).to.equal(false);
      expect(c.lastEvidenceHash).to.equal(ethers.ZeroHash);

      await register(examId, [1, 2, 3]);
      expect(await registry.getCentreIds(examId)).to.deep.equal([14n, 1n, 2n, 3n]);
      expect((await registry.getExam(examId)).centreCount).to.equal(4n);
    });

    it("only the authority can register", async () => {
      const { examId } = await createExam();
      await expect(
        registry.connect(outsider).registerCentres(examId, [1], [rand(32)], [rand(32)], [rand(64)])
      ).to.be.revertedWithCustomError(registry, "NotAuthority");
    });

    it("closes at releaseTime", async () => {
      const { examId, releaseTime } = await createExam();
      await setTime(releaseTime - 1);
      // next tx is mined at releaseTime
      await expect(registry.registerCentres(examId, [1], [rand(32)], [rand(32)], [rand(64)])).to.be.revertedWithCustomError(
        registry,
        "RegistrationClosed"
      );
    });

    it("rejects duplicate centres (across and within batches)", async () => {
      const { examId } = await createExam();
      await register(examId, [1]);
      await expect(register(examId, [1])).to.be.revertedWithCustomError(registry, "CentreExists");
      await expect(register(examId, [2, 2])).to.be.revertedWithCustomError(registry, "CentreExists");
    });

    it("rejects a zero public key", async () => {
      const { examId } = await createExam();
      await expect(
        registry.registerCentres(examId, [1], [ethers.ZeroHash], [rand(32)], [rand(64)])
      ).to.be.revertedWithCustomError(registry, "BadPubKey");
    });

    it("rejects mismatched array lengths", async () => {
      const { examId } = await createExam();
      await expect(
        registry.registerCentres(examId, [1, 2], [rand(32)], [rand(32), rand(32)], [rand(64), rand(64)])
      ).to.be.revertedWithCustomError(registry, "LengthMismatch");
    });
  });

  // ---------------------------------------------------------------- releaseShares

  describe("releaseShares", () => {
    it("reverts the whole tx with ReleaseNotStarted(releaseTime, now) before release time", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      const t = await now();
      await ethers.provider.send("evm_setNextBlockTimestamp", [t + 10]);
      await expect(registry.connect(custodians[0]).releaseShares(examId, [1], [share()]))
        .to.be.revertedWithCustomError(registry, "ReleaseNotStarted")
        .withArgs(releaseTime, t + 10);
      expect(await registry.hasReleased(examId, 1, custodianAddrs[0])).to.equal(false);
    });

    it("rejects non-custodians", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await setTime(releaseTime);
      await expect(registry.connect(outsider).releaseShares(examId, [1], [share()])).to.be.revertedWithCustomError(
        registry,
        "NotCustodian"
      );
      // the authority is not a custodian either
      await expect(registry.releaseShares(examId, [1], [share()])).to.be.revertedWithCustomError(
        registry,
        "NotCustodian"
      );
    });

    it("increments approvals, authorizes exactly once at the threshold, and accepts a 4th share", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1, 2]);
      await setTime(releaseTime);

      const s = custodians.map(() => share());

      await expect(registry.connect(custodians[0]).releaseShares(examId, [1, 2], [s[0], s[0]]))
        .to.emit(registry, "ShareReleased")
        .withArgs(examId, 1, custodianAddrs[0], s[0], 1);
      expect((await registry.getCentre(examId, 1)).approvals).to.equal(1n);

      await expect(registry.connect(custodians[1]).releaseShares(examId, [1], [s[1]])).to.not.emit(
        registry,
        "ReleaseAuthorized"
      );
      expect((await registry.getCentre(examId, 1)).status).to.equal(Status.Sealed);

      const tx3 = await registry.connect(custodians[2]).releaseShares(examId, [1], [s[2]]);
      const ts3 = (await tx3.getBlock())!.timestamp;
      await expect(tx3).to.emit(registry, "ReleaseAuthorized").withArgs(examId, 1, ts3);
      const c3 = await registry.getCentre(examId, 1);
      expect(c3.approvals).to.equal(3n);
      expect(c3.status).to.equal(Status.Released);

      // 4th share still accepted; no second ReleaseAuthorized
      const tx4 = registry.connect(custodians[3]).releaseShares(examId, [1], [s[3]]);
      await expect(tx4).to.emit(registry, "ShareReleased").withArgs(examId, 1, custodianAddrs[3], s[3], 4);
      await expect(tx4).to.not.emit(registry, "ReleaseAuthorized");
      const c4 = await registry.getCentre(examId, 1);
      expect(c4.approvals).to.equal(4n);
      expect(c4.status).to.equal(Status.Released);

      // shares are readable from storage in custodian (piece) order
      const [addrs, shares] = await registry.getShares(examId, 1);
      expect(addrs).to.deep.equal(custodianAddrs);
      expect(shares).to.deep.equal([s[0], s[1], s[2], s[3], "0x"]);
      expect(await registry.hasReleased(examId, 1, custodianAddrs[3])).to.equal(true);
      expect(await registry.hasReleased(examId, 1, custodianAddrs[4])).to.equal(false);

      // centre 2 only got one share
      expect((await registry.getCentre(examId, 2)).approvals).to.equal(1n);
    });

    it("skips a duplicate release with reason 2", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await setTime(releaseTime);
      const first = share();
      await registry.connect(custodians[0]).releaseShares(examId, [1], [first]);
      await expect(registry.connect(custodians[0]).releaseShares(examId, [1], [share()]))
        .to.emit(registry, "ShareSkipped")
        .withArgs(examId, 1, custodianAddrs[0], Skip.Duplicate);
      expect((await registry.getCentre(examId, 1)).approvals).to.equal(1n);
      const [, shares] = await registry.getShares(examId, 1);
      expect(shares[0]).to.equal(first);
    });

    it("skips a compromised centre with reason 1", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await registry.revokeCentre(examId, 1, ethers.id("leak"));
      await setTime(releaseTime);
      await expect(registry.connect(custodians[0]).releaseShares(examId, [1], [share()]))
        .to.emit(registry, "ShareSkipped")
        .withArgs(examId, 1, custodianAddrs[0], Skip.Compromised);
      expect((await registry.getCentre(examId, 1)).approvals).to.equal(0n);
    });

    it("skips an unknown centre with reason 3", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await setTime(releaseTime);
      await expect(registry.connect(custodians[0]).releaseShares(examId, [99], [share()]))
        .to.emit(registry, "ShareSkipped")
        .withArgs(examId, 99, custodianAddrs[0], Skip.UnknownCentre);
    });

    it("skips a share with bad length (outside 48..256) with reason 4", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1, 2, 3, 4]);
      await setTime(releaseTime);
      const tx = registry
        .connect(custodians[0])
        .releaseShares(examId, [1, 2, 3, 4], [rand(47), rand(257), rand(48), rand(256)]);
      await expect(tx).to.emit(registry, "ShareSkipped").withArgs(examId, 1, custodianAddrs[0], Skip.BadLength);
      await expect(tx).to.emit(registry, "ShareSkipped").withArgs(examId, 2, custodianAddrs[0], Skip.BadLength);
      expect((await registry.getCentre(examId, 1)).approvals).to.equal(0n);
      expect((await registry.getCentre(examId, 2)).approvals).to.equal(0n);
      expect((await registry.getCentre(examId, 3)).approvals).to.equal(1n);
      expect((await registry.getCentre(examId, 4)).approvals).to.equal(1n);
    });

    it("rejects mismatched array lengths", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await setTime(releaseTime);
      await expect(
        registry.connect(custodians[0]).releaseShares(examId, [1], [share(), share()])
      ).to.be.revertedWithCustomError(registry, "LengthMismatch");
    });
  });

  // ---------------------------------------------------------------- recordLeak / revokeCentre

  describe("recordLeak and revokeCentre", () => {
    it("recordLeak is authority-only, stores the evidence hash, and emits", async () => {
      const { examId } = await createExam();
      await register(examId, [14]);
      const h = ethers.id("evidence");
      await expect(registry.connect(outsider).recordLeak(examId, 14, h, 31, 33)).to.be.revertedWithCustomError(
        registry,
        "NotAuthority"
      );
      await expect(registry.recordLeak(examId, 14, h, 31, 33))
        .to.emit(registry, "LeakRecorded")
        .withArgs(examId, 14, h, 31, 33);
      expect((await registry.getCentre(examId, 14)).lastEvidenceHash).to.equal(h);
      await expect(registry.recordLeak(examId, 77, h, 1, 1)).to.be.revertedWithCustomError(registry, "CentreNotFound");
    });

    it("revokeCentre is authority-only and idempotent", async () => {
      const { examId } = await createExam();
      await register(examId, [14]);
      const r = ethers.id("Leak traced to Centre 14");
      await expect(registry.connect(outsider).revokeCentre(examId, 14, r)).to.be.revertedWithCustomError(
        registry,
        "NotAuthority"
      );
      await expect(registry.revokeCentre(examId, 14, r)).to.emit(registry, "CentreRevoked").withArgs(examId, 14, r);
      expect((await registry.getCentre(examId, 14)).status).to.equal(Status.Compromised);
      await expect(registry.revokeCentre(examId, 14, r)).to.emit(registry, "CentreRevoked").withArgs(examId, 14, r);
      expect((await registry.getCentre(examId, 14)).status).to.equal(Status.Compromised);
    });

    it("revoking a released centre makes later shares skipped", async () => {
      const { examId, releaseTime } = await createExam();
      await register(examId, [1]);
      await setTime(releaseTime);
      for (let i = 0; i < 3; i++) await registry.connect(custodians[i]).releaseShares(examId, [1], [share()]);
      await registry.revokeCentre(examId, 1, ethers.id("leak"));
      await expect(registry.connect(custodians[3]).releaseShares(examId, [1], [share()]))
        .to.emit(registry, "ShareSkipped")
        .withArgs(examId, 1, custodianAddrs[3], Skip.Compromised);
    });
  });

  // ---------------------------------------------------------------- revealFingerprint

  describe("revealFingerprint", () => {
    const fingerprint = "0x01" + "010000".repeat(12);
    const salt = "0x" + "11".repeat(32);

    async function setup() {
      const { examId, releaseTime, revealTime } = await createExam();
      await register(examId, [14], [fpCommitment(examId, 14, fingerprint, salt)]);
      return { examId, releaseTime, revealTime };
    }

    it("reverts before revealTime with RevealNotStarted", async () => {
      const { examId, revealTime } = await setup();
      await setTime(revealTime - 10);
      await ethers.provider.send("evm_setNextBlockTimestamp", [revealTime - 5]);
      await expect(registry.connect(outsider).revealFingerprint(examId, 14, fingerprint, salt))
        .to.be.revertedWithCustomError(registry, "RevealNotStarted")
        .withArgs(revealTime, revealTime - 5);
    });

    it("rejects a wrong salt with CommitmentMismatch", async () => {
      const { examId, revealTime } = await setup();
      await setTime(revealTime);
      await expect(
        registry.connect(outsider).revealFingerprint(examId, 14, fingerprint, "0x" + "22".repeat(32))
      ).to.be.revertedWithCustomError(registry, "CommitmentMismatch");
    });

    it("anyone can reveal once; the emitted fingerprint matches; a second reveal fails", async () => {
      const { examId, revealTime } = await setup();
      await setTime(revealTime);
      await expect(registry.connect(outsider).revealFingerprint(examId, 14, fingerprint, salt))
        .to.emit(registry, "FingerprintRevealed")
        .withArgs(examId, 14, fingerprint);
      expect((await registry.getCentre(examId, 14)).fingerprintRevealed).to.equal(true);
      await expect(registry.revealFingerprint(examId, 14, fingerprint, salt)).to.be.revertedWithCustomError(
        registry,
        "AlreadyRevealed"
      );
    });
  });

  // ---------------------------------------------------------------- cross-check

  describe("cross-check: TypeScript fingerprint commitment equals Solidity abi.encode", () => {
    it("accepts the viem-computed fixture commitment", async () => {
      const examId = BigInt(fixture.examId);
      // ethers encoding agrees with the viem fixture
      expect(fpCommitment(examId, fixture.centreId, fixture.fingerprint, fixture.salt)).to.equal(
        fixture.fingerprintCommitment
      );
      expect(ethers.getBytes(fixture.fingerprint).length).to.equal(37);

      // create exams until we reach the fixture's examId
      let last = { examId: 0n, revealTime: 0 };
      while (last.examId < examId) last = await createExam();
      expect(last.examId).to.equal(examId);

      await register(examId, [fixture.centreId], [fixture.fingerprintCommitment]);
      await setTime(last.revealTime);
      await expect(registry.revealFingerprint(examId, fixture.centreId, fixture.fingerprint, fixture.salt))
        .to.emit(registry, "FingerprintRevealed")
        .withArgs(examId, fixture.centreId, fixture.fingerprint);
    });
  });
});
